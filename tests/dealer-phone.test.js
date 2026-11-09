'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../src/app');
const { openDb } = require('../src/db');
const { hashPassword } = require('../src/auth');

const SELLER = { SELLER_LEGAL_NAME: 'Højbogaard Biler', SELLER_CVR: '14952705', SELLER_ADDRESS: 'Teknologiparken 4, 9440 Aabybro, Denmark' };

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-phone-'));
  const ctx = createApp({ dbFile: path.join(dir, 't.sqlite'), uploadDir: path.join(dir, 'up'), env: SELLER, noTimer: true, rateLimit: false });
  return { dir, ctx };
}
async function listen(ctx) {
  const server = await new Promise((resolve) => ctx.app.listen(0, '127.0.0.1', function () { resolve(this); }));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
async function send(base, method, url, cookie, body) {
  const headers = { 'x-requested-with': 'autob2b' };
  if (cookie) headers.cookie = cookie;
  let payload;
  if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers, body: payload });
  let json = null;
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}
async function login(base, email, password) {
  const r = await send(base, 'POST', '/api/auth/login', '', { email, password });
  assert.equal(r.status, 200, email);
  const cookie = (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b' }, body: JSON.stringify({ email, password }) })).headers.get('set-cookie').split(';')[0];
  return cookie;
}

test('an existing dealer stays unchanged when the phone column is added', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-phone-old-'));
  const file = path.join(dir, 't.sqlite');
  const raw = new DatabaseSync(file);
  raw.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    company_name TEXT, cvr TEXT, city TEXT,
    created_at TEXT
  )`);
  raw.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('keep@example.test', 'Keep', 'hash', 'Gammel A/S', '11111111', 'Aarhus');
  raw.close();
  const db = openDb(file);
  try {
    const row = db.prepare('SELECT email, name, role, status, company_name, cvr, city, phone FROM users WHERE email=?').get('keep@example.test');
    assert.equal(row.phone, null);
    assert.equal(row.company_name, 'Gammel A/S');
    assert.equal(row.cvr, '11111111');
    assert.equal(row.status, 'approved');
  } finally { db.close(); }
});

test('registration requires a phone, the dealer can change only their own, and admins can see it', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const missing = await send(live.base, 'POST', '/api/auth/register', '', { company_name: 'A', cvr: '22334455', city: 'Aarhus', email: 'nophone@example.test', password: 'Dealer-pass-1234' });
    assert.equal(missing.status, 400);
    const bad = await send(live.base, 'POST', '/api/auth/register', '', { company_name: 'A', cvr: '22334455', city: 'Aarhus', phone: '123', email: 'badphone@example.test', password: 'Dealer-pass-1234' });
    assert.equal(bad.status, 400);
    const created = await send(live.base, 'POST', '/api/auth/register', '', { company_name: 'Ny', cvr: '22334455', city: 'Aarhus', phone: '+45 12 34 56 78', email: 'phone-a@example.test', password: 'Dealer-pass-1234' });
    assert.equal(created.status, 201);
    assert.equal(fx.ctx.db.prepare(`SELECT phone FROM users WHERE email='phone-a@example.test'`).get().phone, '+45 12 34 56 78');
    const other = await send(live.base, 'POST', '/api/auth/register', '', { company_name: 'Anden', cvr: '22334466', city: 'Odense', phone: '87654321', email: 'phone-b@example.test', password: 'Dealer-pass-1234' });
    assert.equal(other.status, 201);
    const adminHash = hashPassword('Phone-Admin-Pass-1');
    fx.ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('phone-admin@example.test', 'Admin', adminHash);
    fx.ctx.db.prepare(`UPDATE users SET status='approved' WHERE email IN ('phone-a@example.test','phone-b@example.test')`).run();
    const a = await login(live.base, 'phone-a@example.test', 'Dealer-pass-1234');
    const b = await login(live.base, 'phone-b@example.test', 'Dealer-pass-1234');
    const admin = await login(live.base, 'phone-admin@example.test', 'Phone-Admin-Pass-1');
    const me = await send(live.base, 'GET', '/api/me', a);
    assert.equal(me.json.user.phone, '+45 12 34 56 78');
    const edited = await send(live.base, 'PUT', '/api/shop/profile', a, { phone: '11223344' });
    assert.equal(edited.status, 200);
    assert.equal(edited.json.user.phone, '11 22 33 44');
    assert.equal(fx.ctx.db.prepare(`SELECT phone FROM users WHERE email='phone-b@example.test'`).get().phone, '87 65 43 21');
    assert.equal((await send(live.base, 'GET', '/api/admin/dealers', b)).status, 403);
    assert.equal((await send(live.base, 'PUT', '/api/shop/profile', admin, { phone: '12345678' })).status, 403);
    const list = await send(live.base, 'GET', '/api/admin/dealers', admin);
    assert.equal(list.json.dealers.find((d) => d.email === 'phone-a@example.test').phone, '11 22 33 44');
    const vehicle = (await send(live.base, 'POST', '/api/admin/vehicles', admin, { vin: 'PHONEVIN0000001', make: 'Test', model: 'En', price: 1000, fuel: 'el', transmission: 'automatic' })).json.vehicle;
    const bought = await send(live.base, 'POST', `/api/shop/vehicles/${vehicle.id}/buy`, a, {});
    assert.equal(bought.status, 201);
    assert.equal(bought.json.order.agreement.buyer.phone, '11 22 33 44');
    const stored = fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(bought.json.order.id).agreement;
    assert.equal((await send(live.base, 'PUT', '/api/shop/profile', a, { phone: '+45 98 76 54 32' })).status, 200);
    assert.equal(fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(bought.json.order.id).agreement, stored);
    const order = await send(live.base, 'GET', '/api/orders/' + bought.json.order.id, admin);
    assert.equal(order.json.order.dealer.phone, '+45 98 76 54 32');
    assert.equal(order.json.order.agreement.buyer.phone, '11 22 33 44');
    assert.deepEqual(order.json.order.agreement, JSON.parse(stored));
    const orders = await send(live.base, 'GET', '/api/admin/orders', admin);
    assert.equal(orders.json.orders.find((o) => o.id === bought.json.order.id).dealer.phone, '+45 98 76 54 32');
    const hidden = await send(live.base, 'GET', '/api/orders/' + bought.json.order.id, b);
    assert.equal(hidden.status, 404);
    assert.equal(JSON.stringify(hidden.json).includes('11 22 33 44'), false);
    const shop = await send(live.base, 'GET', '/api/shop/vehicles', b);
    assert.equal(JSON.stringify(shop.json).includes('11 22 33 44'), false);
  } finally { live.server.close(); fx.ctx.close(); }
});
