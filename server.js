import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
// Defaults to the production MyYaan API so a deploy works without extra config.
const upstreamApiUrl = (process.env.UPSTREAM_API_URL || 'https://my-yaan-dashboard-back-end.vercel.app').replace(/\/$/, '');

function bearerToken(value) {
  return value && /^Bearer\s+.+/i.test(value) ? value : value ? `Bearer ${value}` : null;
}

// The MyYaan API owns authentication. Validate the service-issued token before
// answering dashboard-only requests such as the integration status.
async function requireAuth(req, res, next) {
  const authorization = bearerToken(req.headers.authorization);
  if (!authorization || !upstreamApiUrl) return res.status(401).json({ message: 'Please sign in again.' });
  try {
    const response = await fetch(`${upstreamApiUrl}/api/auth/me`, { headers: { Authorization: authorization } });
    if (!response.ok) return res.status(401).json({ message: 'Please sign in again.' });
    req.user = await response.json().catch(() => ({}));
    next();
  } catch (error) {
    next(error);
  }
}

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });
  if (!upstreamApiUrl) return res.status(503).json({ message: 'Service API is not configured. Set UPSTREAM_API_URL.' });
  let response;
  try {
    response = await fetch(`${upstreamApiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    return res.status(502).json({ message: 'Unable to reach the MyYaan login API. Check its URL and availability, then try again.' });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return res.status(response.status).json(body);
  const authorization = bearerToken(response.headers.get('Authorization') || body.token || body.accessToken || body.data?.token || body.data?.accessToken);
  if (!authorization) return res.status(502).json({ message: 'The service login response did not include an access token.' });
  const token = authorization.replace(/^Bearer\s+/i, '');
  res.set('Authorization', authorization);
  res.json({ ...body, token, user: body.user || body.data?.user || body.data?.admin });
}));

app.get('/api/auth/me', requireAuth, (req, res) => res.json(req.user));

// Every dashboard tab reads from the MyYaan admin API (bookings, coupons,
// service partners). Forward the request with the token issued at login; the
// upstream API validates it, and its 401 tells the browser to sign in again.
app.all('/api/admin/*', asyncRoute(async (req, res) => {
  if (!upstreamApiUrl) return res.status(503).json({ message: 'Service API is not configured. Set UPSTREAM_API_URL.' });
  const authorization = bearerToken(req.headers.authorization);
  if (!authorization) return res.status(401).json({ message: 'Please sign in again.' });
  const init = {
    method: req.method,
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20_000)
  };
  if (!['GET', 'HEAD'].includes(req.method)) init.body = JSON.stringify(req.body ?? {});
  let response;
  try {
    response = await fetch(`${upstreamApiUrl}${req.originalUrl}`, init);
  } catch {
    return res.status(502).json({ message: 'Unable to reach the MyYaan API. Try again in a moment.' });
  }
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: response.status === 404 ? 'This endpoint is not available on the MyYaan API.' : 'Unexpected response from the MyYaan API.' };
  }
  res.status(response.status).json(body);
}));

app.get('/api/integrations/status', requireAuth, (req, res) => res.json({ configured: true, baseUrl: upstreamApiUrl }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ message: err.message || 'Something went wrong. Please try again.' }); });
app.listen(port, () => console.log(`MyYaan dashboard is running on port ${port}`));
