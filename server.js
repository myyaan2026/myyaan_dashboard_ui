import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3002;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const databaseSsl = process.env.DATABASE_SSL?.toLowerCase();
if (databaseSsl && !['true', 'false'].includes(databaseSsl)) {
  throw new Error('DATABASE_SSL must be either true or false');
}

// Most hosted PostgreSQL providers require TLS. Local PostgreSQL servers usually
// do not, so allow that distinction to be configured instead of guessing from a URL.
const ssl = databaseSsl === 'false' ? false : { rejectUnauthorized: false };
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl
});
const secret = process.env.JWT_SECRET || 'development-only-change-me';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  try { req.user = jwt.verify(token, secret); next(); }
  catch { res.status(401).json({ message: 'Please sign in again.' }); }
}
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const upstreamApiUrl = process.env.UPSTREAM_API_URL?.replace(/\/$/, '');
const upstreamApiToken = process.env.UPSTREAM_API_TOKEN;

async function upstreamApi(path, options = {}) {
  if (!upstreamApiUrl || !upstreamApiToken) {
    const error = new Error('Service partner API is not configured. Set UPSTREAM_API_URL and UPSTREAM_API_TOKEN.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${upstreamApiUrl}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${upstreamApiToken}`, 'Content-Type': 'application/json', ...options.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(response.status === 401
      ? 'The service API rejected the access token. Sign in again or verify the service API configuration.'
      : body.message || body.error || 'Coupon service request failed.');
    // Do not forward an upstream 401 as a dashboard 401, otherwise the browser
    // mistakes it for an expired dashboard session and signs the administrator out.
    error.status = response.status === 401 ? 502 : response.status;
    throw error;
  }
  return body;
}

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });
  const { rows } = await pool.query('SELECT * FROM dashboard_users WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ message: 'Invalid email or password.' });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, secret, { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

app.get('/api/auth/me', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT id,name,email,role FROM dashboard_users WHERE id=$1', [req.user.id]);
  res.json(rows[0]);
}));

app.get('/api/dashboard/summary', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM orders WHERE created_at::date = CURRENT_DATE) AS todays_orders,
      (SELECT COUNT(*) FROM orders WHERE status IN ('pending','confirmed','in_progress')) AS active_orders,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='paid' AND paid_at::date = CURRENT_DATE) AS todays_revenue,
      (SELECT COUNT(*) FROM vendors WHERE status='active') AS active_vendors,
      (SELECT COALESCE(json_agg(x ORDER BY x.day), '[]') FROM (
        SELECT TO_CHAR(created_at::date,'Dy') day, created_at::date sort_day, COALESCE(SUM(amount),0)::float value
        FROM orders WHERE created_at >= CURRENT_DATE - INTERVAL '6 days' GROUP BY created_at::date
      ) x) AS revenue_series`);
  const recent = await pool.query(`SELECT o.*, c.name customer_name, v.name vendor_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN vendors v ON v.id=o.vendor_id ORDER BY o.created_at DESC LIMIT 7`);
  res.json({ ...result.rows[0], recentOrders: recent.rows });
}));

app.get('/api/orders', requireAuth, asyncRoute(async (req, res) => {
  const search = `%${req.query.q || ''}%`;
  const { rows } = await pool.query(`SELECT o.*,c.name customer_name,c.phone customer_phone,v.name vendor_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN vendors v ON v.id=o.vendor_id WHERE o.order_code ILIKE $1 OR c.name ILIKE $1 OR c.phone ILIKE $1 ORDER BY o.created_at DESC`, [search]);
  res.json(rows);
}));
app.post('/api/orders', requireAuth, asyncRoute(async (req, res) => {
  const { customerId, vendorId, serviceType, vehicle, scheduledFor, amount, notes } = req.body;
  if (!serviceType) return res.status(400).json({ message: 'Service type is required.' });
  const code = `MY-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${Math.floor(1000 + Math.random()*9000)}`;
  const { rows } = await pool.query(`INSERT INTO orders(order_code,customer_id,vendor_id,service_type,vehicle,scheduled_for,amount,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [code, customerId || null, vendorId || null, serviceType, vehicle || null, scheduledFor || null, amount || 0, notes || null]);
  res.status(201).json(rows[0]);
}));
app.patch('/api/orders/:id/status', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [req.body.status, req.params.id]);
  res.json(rows[0]);
}));

for (const entity of ['customers', 'vendors']) {
  app.get(`/api/${entity}`, requireAuth, asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM ${entity} ORDER BY created_at DESC`); res.json(rows);
  }));
}
app.post('/api/customers', requireAuth, asyncRoute(async (req,res) => {
  const { name, phone, email, vehicle } = req.body;
  const { rows } = await pool.query('INSERT INTO customers(name,phone,email,vehicle) VALUES($1,$2,$3,$4) RETURNING *',[name,phone,email,vehicle]); res.status(201).json(rows[0]);
}));
app.post('/api/vendors', requireAuth, asyncRoute(async (req,res) => {
  const { name, contactName, phone, city, services, rating } = req.body;
  const { rows } = await pool.query('INSERT INTO vendors(name,contact_name,phone,city,services,rating) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[name,contactName,phone,city,services || [],rating || null]); res.status(201).json(rows[0]);
}));
app.get('/api/payments', requireAuth, asyncRoute(async (req,res) => {
  const { rows } = await pool.query(`SELECT p.*,o.order_code,c.name customer_name FROM payments p LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN customers c ON c.id=o.customer_id ORDER BY p.paid_at DESC`); res.json(rows);
}));

app.get('/api/service-partners', requireAuth, asyncRoute(async (req, res) => {
  const allowedFilters = ['page', 'limit', 'search', 'is_active', 'city', 'pincode', 'onboarding_status', 'date_from', 'date_to'];
  const query = new URLSearchParams();
  for (const key of allowedFilters) {
    const value = req.query[key];
    if (typeof value === 'string' && value) query.set(key, value);
  }
  const suffix = query.size ? `?${query}` : '';
  res.json(await upstreamApi(`/api/admin/service-partners${suffix}`));
}));

app.get('/api/service-partners/:id', requireAuth, asyncRoute(async (req, res) => {
  res.json(await upstreamApi(`/api/admin/service-partners/${encodeURIComponent(req.params.id)}`));
}));

app.get('/api/coupons', requireAuth, asyncRoute(async (req, res) => {
  res.json(await upstreamApi('/api/users/coupons'));
}));
app.post('/api/coupons/apply', requireAuth, asyncRoute(async (req, res) => {
  const { couponCode, orderAmount } = req.body;
  if (!couponCode || orderAmount === undefined) return res.status(400).json({ message: 'Coupon code and order amount are required.' });
  res.json(await upstreamApi('/api/users/coupons/apply', {
    method: 'POST', body: JSON.stringify({ couponCode, orderAmount })
  }));
}));

// Calls to the customer/service-partner API belong server-side: never expose its bearer token in the browser.
app.get('/api/integrations/status', requireAuth, (req, res) => res.json({ configured: Boolean(process.env.UPSTREAM_API_URL), baseUrl: process.env.UPSTREAM_API_URL || null }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ message: err.message || 'Something went wrong. Please try again.' }); });
app.listen(port, () => console.log(`MyYaan dashboard is running on port ${port}`));
