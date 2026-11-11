'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

const SELLER = { SELLER_LEGAL_NAME: 'Test Sælger', SELLER_CVR: '12345678', SELLER_ADDRESS: 'Testvej 1, 8000 Aarhus' };

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-sold-'));
  const ctx = createApp({ dbFile: path.join(dir, 't.sqlite'), uploadDir: path.join(dir, 'up'), env: SELLER, noTimer: true, rateLimit: false });
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('sold-admin@example.test', 'Admin', hashPassword('Sold-Admin-Pass-1'));
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('sold-a@example.test', 'Dealer A', hashPassword('Sold-Dealer-A-1'), 'Køber A', '32334455', 'Aarhus');
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('sold-b@example.test', 'Dealer B', hashPassword('Sold-Dealer-B-1'), 'Køber B', '32334466', 'Odense');
  return ctx;
}
async function listen(ctx) {
  const server = await new Promise((resolve) => ctx.app.listen(0, '127.0.0.1', function () { resolve(this); }));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
async function login(base, email, password) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(r.status, 200, email);
  return (r.headers.get('set-cookie') || '').split(';')[0];
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
const car = (vin, price) => ({ vin, make: 'Test', model: vin, price, fuel: 'el', transmission: 'automatic' });

async function finishBuy(base, admin, dealer, vehicleId) {
  const bought = await send(base, 'POST', `/api/shop/vehicles/${vehicleId}/buy`, dealer, {});
  assert.equal(bought.status, 201);
  const done = await send(base, 'POST', `/api/admin/orders/${bought.json.order.id}/complete`, admin, {});
  assert.equal(done.status, 200);
  assert.equal(done.json.order.status, 'completed');
  return bought.json.order;
}

test('a completed car cannot be relisted, deleted, or bought again', async () => {
  const ctx = boot();
  const live = await listen(ctx);
  try {
    const admin = await login(live.base, 'sold-admin@example.test', 'Sold-Admin-Pass-1');
    const a = await login(live.base, 'sold-a@example.test', 'Sold-Dealer-A-1');
    const b = await login(live.base, 'sold-b@example.test', 'Sold-Dealer-B-1');
    const vehicle = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('SOLDVIN000000001', 1000))).json.vehicle;
    const order = await finishBuy(live.base, admin, a, vehicle.id);
    const agreement = ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(order.id).agreement;

    const relist = await send(live.base, 'PUT', '/api/admin/vehicles/' + vehicle.id, admin, { ...car('SOLDVIN000000001', 1000), status: 'available' });
    assert.equal(relist.status, 409);
    const removed = await send(live.base, 'DELETE', '/api/admin/vehicles/' + vehicle.id, admin);
    assert.equal(removed.status, 409);
    assert.equal(ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(vehicle.id).status, 'sold');
    assert.equal((await send(live.base, 'GET', '/api/shop/vehicles?q=SOLDVIN000000001', b)).json.vehicles.some((v) => v.id === vehicle.id), false);
    const [buy, reserve] = await Promise.all([
      send(live.base, 'POST', `/api/shop/vehicles/${vehicle.id}/buy`, b, {}),
      send(live.base, 'POST', `/api/shop/vehicles/${vehicle.id}/reserve`, b, {}),
    ]);
    assert.equal(buy.status, 409);
    assert.equal(reserve.status, 409);
    assert.equal(ctx.db.prepare(`SELECT COUNT(*) n FROM orders WHERE kind='buy'`).get().n, 1);
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(order.id).agreement, agreement);
    assert.equal(ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(vehicle.id).status, 'sold');

    ctx.db.prepare(`UPDATE vehicles SET status='available' WHERE id=?`).run(vehicle.id);
    const hidden = await send(live.base, 'GET', '/api/shop/vehicles?q=SOLDVIN000000001', b);
    assert.equal(hidden.json.vehicles.some((v) => v.id === vehicle.id), false);
    const second = await send(live.base, 'POST', `/api/shop/vehicles/${vehicle.id}/buy`, b, {});
    assert.equal(second.status, 409);
    assert.equal(ctx.db.prepare(`SELECT COUNT(*) n FROM orders`).get().n, 1);
    assert.equal(ctx.db.prepare('SELECT status, agreement FROM orders WHERE id=?').get(order.id).agreement, agreement);
    assert.equal(ctx.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status, 'completed');
    assert.equal(ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(vehicle.id).status, 'available');

    const archived = await send(live.base, 'POST', '/api/admin/orders/' + order.id + '/archive', admin, {});
    assert.equal(archived.status, 200);
    ctx.db.prepare(`UPDATE vehicles SET status='sold' WHERE id=?`).run(vehicle.id);
    assert.equal((await send(live.base, 'PUT', '/api/admin/vehicles/' + vehicle.id, admin, { ...car('SOLDVIN000000001', 1000), status: 'available' })).status, 409);
    assert.equal((await send(live.base, 'DELETE', '/api/admin/vehicles/' + vehicle.id, admin)).status, 409);
    assert.equal((await send(live.base, 'POST', `/api/shop/vehicles/${vehicle.id}/buy`, b, {})).status, 409);
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(order.id).agreement, agreement);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM orders').get().n, 1);
  } finally { live.server.close(); ctx.close(); }
});

test('a completed package and its cars cannot be sold a second time', async () => {
  const ctx = boot();
  const live = await listen(ctx);
  try {
    const admin = await login(live.base, 'sold-admin@example.test', 'Sold-Admin-Pass-1');
    const a = await login(live.base, 'sold-a@example.test', 'Sold-Dealer-A-1');
    const b = await login(live.base, 'sold-b@example.test', 'Sold-Dealer-B-1');
    const v1 = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('SOLDVIN000000011', 2000))).json.vehicle;
    const v2 = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('SOLDVIN000000012', 3000))).json.vehicle;
    const pkg = (await send(live.base, 'POST', '/api/admin/packages', admin, { name: 'Solgt parti', total_price: 4500, vehicle_ids: [v1.id, v2.id] })).json.package;
    const bought = await send(live.base, 'POST', `/api/shop/packages/${pkg.id}/buy`, a, {});
    assert.equal(bought.status, 201);
    assert.equal(bought.json.order.price, 4500);
    const done = await send(live.base, 'POST', `/api/admin/orders/${bought.json.order.id}/complete`, admin, {});
    assert.equal(done.status, 200);
    const agreement = ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(bought.json.order.id).agreement;
    assert.equal(JSON.parse(agreement).price_excl_vat, 4500);

    for (const vehicle of [v1, v2]) {
      assert.equal((await send(live.base, 'PUT', '/api/admin/vehicles/' + vehicle.id, admin, { ...car(vehicle.vin, vehicle.price), status: 'available' })).status, 409);
      assert.equal((await send(live.base, 'DELETE', '/api/admin/vehicles/' + vehicle.id, admin)).status, 409);
      assert.equal((await send(live.base, 'POST', `/api/shop/vehicles/${vehicle.id}/buy`, b, {})).status, 409);
      assert.equal(ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(vehicle.id).status, 'sold');
    }
    assert.equal((await send(live.base, 'POST', `/api/shop/packages/${pkg.id}/buy`, b, {})).status, 409);
    assert.equal((await send(live.base, 'POST', `/api/shop/packages/${pkg.id}/reserve`, b, {})).status, 409);
    assert.equal((await send(live.base, 'DELETE', '/api/admin/packages/' + pkg.id, admin)).json.archived, true);
    assert.equal((await send(live.base, 'GET', '/api/admin/packages', admin)).json.packages.some((p) => p.id === pkg.id), false);
    assert.equal((await send(live.base, 'PUT', '/api/admin/packages/' + pkg.id, admin, { name: 'Solgt parti', total_price: 4500, vehicle_ids: [v1.id, v2.id] })).status, 409);
    assert.equal(ctx.db.prepare('SELECT status FROM packages WHERE id=?').get(pkg.id).status, 'sold');
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(bought.json.order.id).agreement, agreement);
    assert.equal(ctx.db.prepare(`SELECT COUNT(*) n FROM orders WHERE kind='buy'`).get().n, 1);

    ctx.db.prepare(`UPDATE vehicles SET status='available' WHERE id=?`).run(v1.id);
    assert.equal((await send(live.base, 'GET', '/api/shop/vehicles?q=SOLDVIN000000011', b)).json.vehicles.some((v) => v.id === v1.id), false);
    assert.equal((await send(live.base, 'POST', `/api/shop/vehicles/${v1.id}/buy`, b, {})).status, 409);
    assert.equal((await send(live.base, 'POST', `/api/shop/packages/${pkg.id}/buy`, b, {})).status, 409);
    assert.equal(ctx.db.prepare('SELECT status FROM packages WHERE id=?').get(pkg.id).status, 'sold');
    assert.equal(ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(v1.id).status, 'available');
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(bought.json.order.id).agreement, agreement);
    assert.equal(ctx.db.prepare(`SELECT COUNT(*) n FROM orders`).get().n, 1);

    assert.equal((await send(live.base, 'POST', '/api/admin/orders/' + bought.json.order.id + '/archive', admin, {})).status, 200);
    ctx.db.prepare(`UPDATE vehicles SET status='sold' WHERE id=?`).run(v1.id);
    assert.equal((await send(live.base, 'PUT', '/api/admin/vehicles/' + v1.id, admin, { ...car(v1.vin, v1.price), status: 'available' })).status, 409);
    assert.equal((await send(live.base, 'POST', `/api/shop/vehicles/${v2.id}/buy`, b, {})).status, 409);
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(bought.json.order.id).agreement, agreement);
  } finally { live.server.close(); ctx.close(); }
});

test('confirmed sales stay locked until the order is cancelled, including after archive', async () => {
  const ctx = boot();
  const live = await listen(ctx);
  try {
    const admin = await login(live.base, 'sold-admin@example.test', 'Sold-Admin-Pass-1');
    const a = await login(live.base, 'sold-a@example.test', 'Sold-Dealer-A-1');
    const b = await login(live.base, 'sold-b@example.test', 'Sold-Dealer-B-1');
    const vehicle = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('SOLDVIN000000021', 2200))).json.vehicle;
    const bought = await send(live.base, 'POST', `/api/shop/vehicles/${vehicle.id}/buy`, a, {});
    assert.equal(bought.status, 201);
    assert.equal(bought.json.order.status, 'confirmed');
    const agreement = ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(bought.json.order.id).agreement;
    assert.equal((await send(live.base, 'PUT', '/api/admin/vehicles/' + vehicle.id, admin, { ...car('SOLDVIN000000021', 2200), status: 'available' })).status, 409);
    assert.equal((await send(live.base, 'DELETE', '/api/admin/vehicles/' + vehicle.id, admin)).status, 409);
    assert.equal((await send(live.base, 'POST', `/api/shop/vehicles/${vehicle.id}/buy`, b, {})).status, 409);

    assert.equal((await send(live.base, 'POST', '/api/admin/orders/' + bought.json.order.id + '/archive', admin, {})).status, 200);
    assert.equal(ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(vehicle.id).status, 'sold');
    assert.equal((await send(live.base, 'PUT', '/api/admin/vehicles/' + vehicle.id, admin, { ...car('SOLDVIN000000021', 2200), status: 'available' })).status, 409);
    assert.equal((await send(live.base, 'POST', `/api/shop/vehicles/${vehicle.id}/buy`, b, {})).status, 409);
    assert.equal((await send(live.base, 'POST', '/api/admin/orders/' + bought.json.order.id + '/restore', admin, {})).status, 200);
    assert.equal(ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(vehicle.id).status, 'sold');

    const cancelled = await send(live.base, 'POST', '/api/admin/orders/' + bought.json.order.id + '/cancel', admin, {});
    assert.equal(cancelled.status, 200);
    assert.equal(ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(vehicle.id).status, 'available');
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(bought.json.order.id).agreement, agreement);
    const again = await send(live.base, 'POST', `/api/shop/vehicles/${vehicle.id}/buy`, b, {});
    assert.equal(again.status, 201);
    assert.equal(ctx.db.prepare(`SELECT COUNT(*) n FROM orders WHERE kind='buy' AND status='confirmed'`).get().n, 1);
  } finally { live.server.close(); ctx.close(); }
});
