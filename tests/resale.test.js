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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-resale-'));
  const ctx = createApp({ dbFile: path.join(dir, 't.sqlite'), uploadDir: path.join(dir, 'up'), env: SELLER, noTimer: true, rateLimit: false });
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('resale-admin@example.test', 'Resale Admin', hashPassword('Resale-Admin-Pass-1'));
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('resale-a@example.test', 'Dealer A', hashPassword('Resale-Dealer-A-1'), 'Køber A', '42334455', 'Aarhus');
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('resale-b@example.test', 'Dealer B', hashPassword('Resale-Dealer-B-1'), 'Køber B', '42334466', 'Odense');
  return ctx;
}
function listen(ctx) {
  return new Promise((resolve) => ctx.app.listen(0, '127.0.0.1', function () { resolve({ server: this, base: `http://127.0.0.1:${this.address().port}` }); }));
}
async function send(base, method, url, cookie, body) {
  const headers = { 'x-requested-with': 'autob2b' };
  if (cookie) headers.cookie = cookie;
  let payload;
  if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers, body: payload });
  let json = null;
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
async function login(base, email, password) {
  const r = await send(base, 'POST', '/api/auth/login', '', { email, password });
  assert.equal(r.status, 200, email);
  return r.cookie;
}
const car = (vin, price = 10000) => ({ vin, make: 'VW', model: vin, variant: 'Trend', price, fuel: 'el', transmission: 'automatic' });

test('resale columns and the log table are additive and do not rewrite existing rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-resale-old-'));
  const file = path.join(dir, 't.sqlite');
  const raw = new DatabaseSync(file);
  raw.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'approved',
    company_name TEXT, cvr TEXT, city TEXT, created_at TEXT
  )`);
  raw.exec(`CREATE TABLE vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vin TEXT NOT NULL UNIQUE, make TEXT NOT NULL, model TEXT NOT NULL,
    price INTEGER NOT NULL, images TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, created_at TEXT
  )`);
  raw.exec(`CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dealer_id INTEGER NOT NULL, vehicle_id INTEGER, package_id INTEGER,
    kind TEXT NOT NULL, status TEXT NOT NULL, price INTEGER NOT NULL, item_label TEXT NOT NULL,
    agreement TEXT, created_at TEXT
  )`);
  raw.exec(`CREATE TABLE order_vehicles (order_id INTEGER NOT NULL, vehicle_id INTEGER NOT NULL, PRIMARY KEY (order_id, vehicle_id))`);
  raw.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name) VALUES (?,?,?,'dealer','approved',?)`).run('old@example.test', 'Old', 'hash', 'Gammel A/S');
  raw.prepare(`INSERT INTO vehicles (vin,make,model,price,status) VALUES (?,?,?,?,?)`).run('OLDVIN0000000001', 'VW', 'Golf', 1000, 'sold');
  raw.prepare(`INSERT INTO orders (dealer_id,vehicle_id,kind,status,price,item_label,agreement) VALUES (1,1,'buy','completed',1000,'VW Golf',?)`).run('{"number":"AG-OLD"}');
  raw.prepare('INSERT INTO order_vehicles (order_id,vehicle_id) VALUES (1,1)').run();
  raw.close();
  const first = openDb(file);
  const order = first.prepare('SELECT agreement, status, price, item_label, cancelled_at, cancel_reason FROM orders WHERE id=1').get();
  assert.equal(order.agreement, '{"number":"AG-OLD"}');
  assert.equal(order.status, 'completed');
  assert.equal(order.price, 1000);
  assert.equal(order.cancelled_at, null);
  assert.equal(order.cancel_reason, null);
  assert.equal(first.prepare('SELECT cancelled_at, cancel_reason FROM order_vehicles WHERE order_id=1').get().cancelled_at, null);
  assert.equal(first.prepare('SELECT COUNT(*) n FROM resale_log').get().n, 0);
  const snap = first.prepare('SELECT * FROM orders WHERE id=1').get();
  first.close();
  const second = openDb(file);
  try {
    assert.deepEqual(second.prepare('SELECT * FROM orders WHERE id=1').get(), snap);
    assert.equal(second.prepare('SELECT COUNT(*) n FROM resale_log').get().n, 0);
  } finally { second.close(); }
});

test('Sæt til salg igen cancels one sale, deletes only that agreement, and can be bought again', async () => {
  const ctx = boot();
  const live = await listen(ctx);
  try {
    const admin = await login(live.base, 'resale-admin@example.test', 'Resale-Admin-Pass-1');
    const a = await login(live.base, 'resale-a@example.test', 'Resale-Dealer-A-1');
    const b = await login(live.base, 'resale-b@example.test', 'Resale-Dealer-B-1');
    const keep = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('RESALEVINKEEP001', 5000))).json.vehicle;
    const sold = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('RESALEVIN0000001', 8000))).json.vehicle;
    const otherBuy = await send(live.base, 'POST', '/api/shop/vehicles/' + keep.id + '/buy', b, {});
    assert.equal(otherBuy.status, 201);
    const otherAgreement = ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(otherBuy.json.order.id).agreement;
    const bought = await send(live.base, 'POST', '/api/shop/vehicles/' + sold.id + '/buy', a, {});
    assert.equal(bought.status, 201);
    const orderId = bought.json.order.id;
    await send(live.base, 'POST', '/api/admin/orders/' + orderId + '/complete', admin, {});
    const beforeOrders = ctx.db.prepare('SELECT COUNT(*) n FROM orders').get().n;
    const missing = await send(live.base, 'POST', '/api/admin/orders/' + orderId + '/resell', admin, { vehicle_id: sold.id, reason: 'glemt' });
    assert.equal(missing.status, 400);
    assert.equal(ctx.db.prepare('SELECT agreement, status FROM orders WHERE id=?').get(orderId).status, 'completed');
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM resale_log').get().n, 0);
    assert.equal((await send(live.base, 'POST', '/api/admin/orders/' + orderId + '/resell', a, { confirm: true, vehicle_id: sold.id })).status, 403);
    ctx.db.prepare('UPDATE vehicles SET archived_at=? WHERE id=?').run('2026-01-01T00:00:00.000Z', sold.id);
    const ordersBeforeRestore = ctx.db.prepare('SELECT COUNT(*) n FROM orders').get().n;
    const agreementBeforeRestore = ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(orderId).agreement;
    const blocked = await send(live.base, 'POST', '/api/admin/orders/' + orderId + '/resell', admin, { confirm: true, vehicle_id: sold.id, reason: 'faldet' });
    assert.equal(blocked.status, 409);
    assert.equal(ctx.db.prepare('SELECT cancelled_at FROM order_vehicles WHERE order_id=? AND vehicle_id=?').get(orderId, sold.id).cancelled_at, null);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM resale_log').get().n, 0);
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(orderId).agreement, agreementBeforeRestore);
    const restored = await send(live.base, 'POST', '/api/admin/vehicles/' + sold.id + '/restore', admin, {});
    assert.equal(restored.status, 200);
    assert.equal(restored.json.vehicle.status, 'sold');
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM orders').get().n, ordersBeforeRestore);
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(orderId).agreement, agreementBeforeRestore);
    const done = await send(live.base, 'POST', '/api/admin/orders/' + orderId + '/resell', admin, { confirm: true, vehicle_id: sold.id, reason: 'Handlen faldt' });
    assert.equal(done.status, 200);
    assert.equal(done.json.order.status, 'cancelled');
    assert.equal(done.json.order.agreement, undefined);
    assert.equal(ctx.db.prepare('SELECT agreement, status FROM orders WHERE id=?').get(orderId).agreement, null);
    assert.equal(ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(sold.id).status, 'available');
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(otherBuy.json.order.id).agreement, otherAgreement);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM orders').get().n, beforeOrders);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM order_vehicles WHERE order_id=?').get(orderId).n, 1);
    const log = ctx.db.prepare('SELECT * FROM resale_log').all();
    assert.equal(log.length, 1);
    assert.equal(log[0].admin_email, 'resale-admin@example.test');
    assert.equal(log[0].admin_name, 'Resale Admin');
    assert.equal(log[0].order_id, orderId);
    assert.equal(log[0].vehicle_id, sold.id);
    assert.equal(log[0].vehicle_reg, 'RESALEVIN0000001');
    assert.match(log[0].vehicle_title, /VW/);
    assert.equal(log[0].dealer_name, 'Køber A');
    assert.match(log[0].agreement_number, /^AG-/);
    assert.equal(log[0].reason, 'Handlen faldt');
    assert.match(log[0].created_at, /Z$/);
    const again = await send(live.base, 'POST', '/api/admin/orders/' + orderId + '/resell', admin, { confirm: true, vehicle_id: sold.id });
    assert.equal(again.status, 409);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM resale_log').get().n, 1);
    const mine = await send(live.base, 'GET', '/api/shop/orders', a);
    assert.equal(mine.json.orders.find((o) => o.id === orderId).status, 'cancelled');
    assert.equal(mine.json.orders.find((o) => o.id === orderId).has_agreement, false);
    const theirs = await send(live.base, 'GET', '/api/shop/orders', b);
    assert.equal(theirs.json.orders.some((o) => o.id === orderId), false);
    assert.equal((await send(live.base, 'GET', '/api/orders/' + orderId, b)).status, 404);
    const listed = await send(live.base, 'GET', '/api/shop/vehicles?q=RESALEVIN0000001', b);
    assert.equal(listed.json.vehicles.some((v) => v.id === sold.id), true);
    const rebought = await send(live.base, 'POST', '/api/shop/vehicles/' + sold.id + '/buy', b, {});
    assert.equal(rebought.status, 201);
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(otherBuy.json.order.id).agreement, otherAgreement);
    assert.equal((await send(live.base, 'GET', '/api/admin/resale-log', a)).status, 403);
    const adminLog = await send(live.base, 'GET', '/api/admin/resale-log', admin);
    assert.equal(adminLog.status, 200);
    assert.equal(adminLog.json.log[0].order_id, orderId);
    assert.equal(fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8').includes('DELETE FROM resale_log'), false);
  } finally { live.server.close(); ctx.close(); }
});

test('a multi-car order releases only the chosen car and deletes that order agreement', async () => {
  const ctx = boot();
  const live = await listen(ctx);
  try {
    const admin = await login(live.base, 'resale-admin@example.test', 'Resale-Admin-Pass-1');
    const a = await login(live.base, 'resale-a@example.test', 'Resale-Dealer-A-1');
    const b = await login(live.base, 'resale-b@example.test', 'Resale-Dealer-B-1');
    const one = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('MULTIVIN00000001', 1000))).json.vehicle;
    const two = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('MULTIVIN00000002', 2000))).json.vehicle;
    const untouched = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('MULTIVIN00000003', 3000))).json.vehicle;
    const other = await send(live.base, 'POST', '/api/shop/vehicles/' + untouched.id + '/buy', b, {});
    const otherAgreement = ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(other.json.order.id).agreement;
    assert.equal((await send(live.base, 'POST', '/api/shop/cart', a, { vehicle_ids: [one.id, two.id] })).status, 201);
    const bought = await send(live.base, 'POST', '/api/shop/cart/buy', a, {});
    assert.equal(bought.status, 201);
    const orderId = bought.json.order.id;
    const ownAgreement = ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(orderId).agreement;
    assert.match(ownAgreement, /MULTIVIN00000001/);
    const released = await send(live.base, 'POST', '/api/admin/orders/' + orderId + '/resell', admin, { confirm: true, vehicle_id: one.id, reason: 'én bil' });
    assert.equal(released.status, 200);
    assert.equal(released.json.order.status, 'confirmed');
    assert.equal(ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(one.id).status, 'available');
    assert.equal(ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(two.id).status, 'sold');
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(orderId).agreement, null);
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(other.json.order.id).agreement, otherAgreement);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM order_vehicles WHERE order_id=?').get(orderId).n, 2);
    const log = ctx.db.prepare('SELECT * FROM resale_log WHERE order_id=?').get(orderId);
    assert.equal(log.vehicle_id, one.id);
    assert.equal(log.reason, 'én bil');
    const shop = await send(live.base, 'GET', '/api/shop/vehicles?q=MULTIVIN00000001', b);
    assert.equal(shop.json.vehicles.some((v) => v.id === one.id), true);
    assert.equal((await send(live.base, 'GET', '/api/shop/vehicles?q=MULTIVIN00000002', b)).json.vehicles.some((v) => v.id === two.id), false);
  } finally { live.server.close(); ctx.close(); }
});

test('the resale button is only on admin order actions', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const vehicles = src.slice(src.indexOf('async function vehiclesPage'), src.indexOf('async function packagesPage'));
  const shop = src.slice(src.indexOf('async function shopOrders'), src.indexOf('async function agreementPage'));
  const orders = src.slice(src.indexOf('function resaleButtons'), src.indexOf('async function dealersPage'));
  assert.equal(vehicles.includes('Sæt til salg igen'), false);
  assert.equal(shop.includes('Sæt til salg igen'), false);
  assert.match(orders, /Sæt til salg igen/);
  assert.match(orders, /Købsaftalen dækker hele ordren og slettes også/);
  assert.match(src, /confirm: true, vehicle_id/);
  assert.match(orders, /id="resale-ok">OK</);
  assert.match(orders, /id="resale-cancel">Annuller</);
  assert.match(orders, /<h2>Salgslog<\/h2>/);
  assert.match(src, /<div class="order-actions">/);
});
