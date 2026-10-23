import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import bcrypt from 'bcryptjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const databaseSsl = process.env.DATABASE_SSL?.toLowerCase();
if (databaseSsl && !['true', 'false'].includes(databaseSsl)) {
  throw new Error('DATABASE_SSL must be either true or false');
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSsl === 'false' ? false : { rejectUnauthorized: false }
});
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
await pool.query(schema);
const email = process.env.ADMIN_EMAIL || 'admin@myyaan.com';
const password = process.env.ADMIN_PASSWORD;
if (!password) throw new Error('ADMIN_PASSWORD is required to create the initial admin');
const hash = await bcrypt.hash(password, 12);
await pool.query(
  `INSERT INTO dashboard_users (email, password_hash, name, role) VALUES ($1,$2,'MyYaan Admin','admin')
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
  [email, hash]
);
console.log(`Database ready. Admin: ${email}`);
await pool.end();
