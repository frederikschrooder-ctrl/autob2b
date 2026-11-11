'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

const SELLER = { SELLER_LEGAL_NAME: 'Højbogaard Biler', SELLER_CVR: '14952705', SELLER_ADDRESS: 'Teknologiparken 4, 9440 Aabybro, Denmark' };

function boot(env = SELLER) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-cart-'));
  const ctx = createApp({ dbFile: path.join(dir, 't.sqlite'), uploadDir: path.join(dir, 'up'), env, noTimer: true, rateLimit: false });
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('cart-admin@example.test', 'Admin', hashPassword('Cart-Admin-Pass-1'));
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('cart-dealer@example.test', 'Dealer', hashPassword('Cart-Dealer-Pass-1'), 'Køber A/S', '11223344', 'Aarhus');
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('cart-other@example.test', 'Other', hashPassword('Cart-Other-Pass-1'), 'Anden A/S', '11223355', 'Odense');
  return { dir, ctx };
}
async function listen(ctx) {
  const server = await new Promise((resolve) => ctx.app.listen(0, '127.0.0.1', function () { resolve(this); }));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
async function login(base, email, password) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b' }, body: JSON.stringify({ email, password }) });
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
const car = (vin, price = 10000) => ({ vin, make: 'Test', model: vin, price, fuel: 'el', transmission: 'automatic' });

test('a dealer adds several cars to one cart and buys them as one order', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'cart-admin@example.test', 'Cart-Admin-Pass-1');
    const dealer = await login(live.base, 'cart-dealer@example.test', 'Cart-Dealer-Pass-1');
    const a = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('CARTVIN000000001', 10000))).json.vehicle;
    const b = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('CARTVIN000000002', 20000))).json.vehicle;
    const c = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('CARTVIN000000003', 30000))).json.vehicle;
    const first = await send(live.base, 'POST', '/api/shop/cart', dealer, { vehicle_ids: [a.id, b.id] });
    assert.equal(first.status, 201);
    assert.equal(first.json.cart.count, 2);
    const again = await send(live.base, 'POST', '/api/shop/cart', dealer, { vehicle_ids: [b.id, c.id] });
    assert.equal(again.status, 200);
    assert.deepEqual(again.json.cart.vehicles.map((v) => v.id), [a.id, b.id, c.id]);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM carts').get().n, 1);
    assert.equal(again.json.cart.price_excl_vat, 60000);
    assert.equal(again.json.cart.vat, 15000);
    assert.equal(again.json.cart.total_incl_vat, 75000);
    const bought = await send(live.base, 'POST', '/api/shop/cart/buy', dealer, {});
    assert.equal(bought.status, 201);
    assert.equal(bought.json.order.kind, 'buy');
    assert.equal(bought.json.order.price, 60000);
    assert.equal(bought.json.order.vehicle_id, null);
    assert.equal(bought.json.order.agreement.items.length, 3);
    assert.deepEqual(bought.json.order.agreement.items.map((i) => i.vin), ['CARTVIN000000001', 'CARTVIN000000002', 'CARTVIN000000003']);
    assert.equal(bought.json.order.agreement.seller.name, 'Højbogaard Biler');
    assert.equal(bought.json.order.agreement.seller.cvr, '14952705');
    assert.equal(bought.json.order.agreement.price_excl_vat, 60000);
    assert.equal(bought.json.order.agreement.vat, 15000);
    assert.equal(bought.json.order.agreement.total_incl_vat, 75000);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM order_vehicles WHERE order_id=?').get(bought.json.order.id).n, 3);
    assert.equal(fx.ctx.db.prepare(`SELECT COUNT(*) n FROM vehicles WHERE status='sold'`).get().n, 3);
    assert.equal((await send(live.base, 'GET', '/api/shop/cart', dealer)).json.cart.count, 0);
    const adminList = await send(live.base, 'GET', '/api/admin/orders', admin);
    assert.equal(adminList.json.orders.some((o) => o.id === bought.json.order.id), true);
    assert.equal((await send(live.base, 'POST', '/api/shop/cart', admin, { vehicle_ids: [a.id] })).status, 403);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('adding a mix of available and reserved cars changes nothing', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'cart-admin@example.test', 'Cart-Admin-Pass-1');
    const dealer = await login(live.base, 'cart-dealer@example.test', 'Cart-Dealer-Pass-1');
    const other = await login(live.base, 'cart-other@example.test', 'Cart-Other-Pass-1');
    const free = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('CARTVIN000000011'))).json.vehicle;
    const held = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('CARTVIN000000012'))).json.vehicle;
    assert.equal((await send(live.base, 'POST', '/api/shop/vehicles/' + held.id + '/reserve', other, {})).status, 201);
    const refused = await send(live.base, 'POST', '/api/shop/cart', dealer, { vehicle_ids: [free.id, held.id] });
    assert.equal(refused.status, 409);
    assert.match(refused.json.error, /ikke længere tilgængelig/);
    assert.match(refused.json.error, /CARTVIN000000012/);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM carts').get().n, 0);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM cart_vehicles').get().n, 0);
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(free.id).status, 'available');
  } finally { live.server.close(); fx.ctx.close(); }
});

test('two dealers cannot both buy the same cart car', async () => {
  const fx = boot();
  const dealerA = fx.ctx.db.prepare(`SELECT id FROM users WHERE email='cart-dealer@example.test'`).get().id;
  const dealerB = fx.ctx.db.prepare(`SELECT id FROM users WHERE email='cart-other@example.test'`).get().id;
  const vehicle = Number(fx.ctx.db.prepare(`INSERT INTO vehicles (vin,make,model,price,fuel,transmission,status) VALUES ('CARTVIN000000021','Race','Shared',40000,'el','automatic','available')`).run().lastInsertRowid);
  const stamp = new Date().toISOString();
  const cartA = Number(fx.ctx.db.prepare('INSERT INTO carts (dealer_id, created_at) VALUES (?,?)').run(dealerA, stamp).lastInsertRowid);
  const cartB = Number(fx.ctx.db.prepare('INSERT INTO carts (dealer_id, created_at) VALUES (?,?)').run(dealerB, stamp).lastInsertRowid);
  fx.ctx.db.prepare('INSERT INTO cart_vehicles (cart_id, vehicle_id) VALUES (?,?)').run(cartA, vehicle);
  fx.ctx.db.prepare('INSERT INTO cart_vehicles (cart_id, vehicle_id) VALUES (?,?)').run(cartB, vehicle);
  const dbFile = path.join(fx.dir, 't.sqlite');
  const uploadDir = path.join(fx.dir, 'up');
  fx.ctx.close();
  const worker = path.join(__dirname, 'buy-worker.js');
  function once(email) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [worker], {
        env: {
          PATH: process.env.PATH || '', HOME: process.env.HOME || '',
          ...SELLER,
          DB_FILE: dbFile, UPLOAD_DIR: uploadDir, EMAIL: email,
          PASSWORD: email.startsWith('cart-dealer') ? 'Cart-Dealer-Pass-1' : 'Cart-Other-Pass-1',
          BUY_PATH: '/api/shop/cart/buy',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('exit', (code) => {
        if (code !== 0) return reject(new Error(err.slice(0, 500)));
        resolve(JSON.parse(out));
      });
    });
  }
  const results = await Promise.all([once('cart-dealer@example.test'), once('cart-other@example.test')]);
  const statuses = results.map((r) => r.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409], JSON.stringify(results));
  const check = createApp({ dbFile, uploadDir, env: SELLER, noTimer: true, rateLimit: false });
  try {
    assert.equal(check.db.prepare('SELECT status FROM vehicles WHERE id=?').get(vehicle).status, 'sold');
    assert.equal(check.db.prepare(`SELECT COUNT(*) n FROM orders WHERE kind='buy' AND status='confirmed'`).get().n, 1);
    assert.equal(check.db.prepare('SELECT COUNT(*) n FROM order_vehicles WHERE vehicle_id=?').get(vehicle).n, 1);
  } finally { check.close(); }
});

test('a cart purchase lists every vehicle and leaves an older agreement unchanged', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'cart-admin@example.test', 'Cart-Admin-Pass-1');
    const dealer = await login(live.base, 'cart-dealer@example.test', 'Cart-Dealer-Pass-1');
    const oldCar = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('CARTVIN000000031', 8000))).json.vehicle;
    const oldBuy = await send(live.base, 'POST', '/api/shop/vehicles/' + oldCar.id + '/buy', dealer, {});
    assert.equal(oldBuy.status, 201);
    const stored = fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(oldBuy.json.order.id).agreement;
    const extra = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('CARTVIN000000032', 9000))).json.vehicle;
    const more = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('CARTVIN000000033', 11000))).json.vehicle;
    assert.equal((await send(live.base, 'POST', '/api/shop/cart', dealer, { vehicle_ids: [extra.id, more.id] })).status, 201);
    const bought = await send(live.base, 'POST', '/api/shop/cart/buy', dealer, {});
    assert.equal(bought.status, 201);
    assert.equal(fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(oldBuy.json.order.id).agreement, stored);
    const shown = await send(live.base, 'GET', '/api/orders/' + bought.json.order.id, dealer);
    assert.equal(shown.json.order.agreement.items.length, 2);
    assert.equal(shown.json.order.agreement.seller.name, 'Højbogaard Biler');
    const fresh = fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(bought.json.order.id).agreement;
    live.server.close();
    fx.ctx.close();
    fx.closed = true;
    const again = createApp({ dbFile: path.join(fx.dir, 't.sqlite'), uploadDir: path.join(fx.dir, 'up'), env: SELLER, noTimer: true, rateLimit: false });
    try {
      assert.equal(again.db.prepare('SELECT agreement FROM orders WHERE id=?').get(oldBuy.json.order.id).agreement, stored);
      assert.equal(again.db.prepare('SELECT agreement FROM orders WHERE id=?').get(bought.json.order.id).agreement, fresh);
    } finally { again.close(); }
  } finally { if (!fx.closed) { live.server.close(); fx.ctx.close(); } }
});

test('the shop list adds one car at a time and Bestil samlet places one order', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const shop = src.slice(src.indexOf('function cartIcon'), src.indexOf('async function shopVehicle'));
  assert.match(shop, /Tilføj til kurv/);
  assert.match(shop, /I kurven/);
  assert.match(shop, /Se detaljer/);
  assert.match(shop, /data-add=/);
  assert.match(shop, /data-drop=/);
  assert.match(shop, /id="cartcount"/);
  assert.match(shop, /Bestil samlet/);
  assert.match(shop, /class="cart"/);
  assert.match(shop, /class="cart-head"/);
  assert.match(shop, /class="cart-summary"/);
  assert.match(shop, /Pris ekskl\. moms/);
  assert.match(shop, /I alt inkl\. moms/);
  assert.match(shop, /← Biler/);
  assert.equal(shop.includes('data-pick'), false);
  assert.equal(shop.includes('cartbar'), false);
  const cartFn = src.slice(src.indexOf('async function shopCart'), src.indexOf('async function shopVehicle'));
  const head = cartFn.slice(cartFn.indexOf('class="cart-head"'), cartFn.indexOf('cart-body'));
  assert.match(head, /Kurv/);
  assert.match(head, /← Biler/);
  assert.match(src, /\/api\/shop\/cart\/buy/);
  const orders = src.slice(src.indexOf('async function shopOrders'), src.indexOf('async function agreementPage'));
  assert.equal(orders.includes('data-add'), false);
});
