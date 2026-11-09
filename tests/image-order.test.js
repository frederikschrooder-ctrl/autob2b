'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

const A = '/uploads/' + 'a'.repeat(32) + '.jpg';
const B = '/uploads/' + 'b'.repeat(32) + '.jpg';
const C = '/uploads/' + 'c'.repeat(32) + '.jpg';

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-img-'));
  const dbFile = path.join(dir, 't.sqlite');
  const ctx = createApp({ dbFile, uploadDir: path.join(dir, 'up'), env: {}, noTimer: true, rateLimit: false });
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('img-admin@example.test', 'Admin', hashPassword('Img-Admin-Pass-1'));
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('img-dealer@example.test', 'Dealer', hashPassword('Img-Dealer-Pass-1'), 'Køber', '42334455', 'Aarhus');
  return { dir, dbFile, ctx };
}
async function listen(ctx) {
  const server = await new Promise((resolve) => ctx.app.listen(0, '127.0.0.1', function () { resolve(this); }));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
async function login(base, email, password) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b' }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200);
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function send(base, method, url, cookie, body, headers = {}) {
  const h = { 'x-requested-with': 'autob2b', ...headers };
  if (cookie) h.cookie = cookie;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body: payload });
  let json = null;
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}

test('startup does not rewrite existing vehicles, packages, images, orders, or agreements', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-imgmig-'));
  const dbFile = path.join(dir, 't.sqlite');
  const agreement = JSON.stringify({ seller: { name: 'Højbogaard Biler', cvr: '14952705' }, price_excl_vat: 4500, items: [{ vin: 'OLDVIN000000001', price: 2000 }, { vin: 'OLDVIN000000002', price: 3000 }] });
  const images = JSON.stringify([A, B]);
  const first = createApp({ dbFile, uploadDir: path.join(dir, 'up'), env: {}, noTimer: true, rateLimit: false });
  first.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('old-dealer@example.test', 'Dealer', hashPassword('Old-Dealer-Pass-1'), 'Gammel', '62334455', 'Aabybro');
  const dealerId = Number(first.db.prepare(`SELECT id FROM users WHERE email='old-dealer@example.test'`).get().id);
  const v1 = Number(first.db.prepare(`INSERT INTO vehicles (vin,make,model,price,images,status) VALUES (?,?,?,?,?,?)`).run('OLDVIN000000001', 'Audi', 'A4', 2000, images, 'sold').lastInsertRowid);
  const v2 = Number(first.db.prepare(`INSERT INTO vehicles (vin,make,model,price,images,status) VALUES (?,?,?,?,?,?)`).run('OLDVIN000000002', 'BMW', '320', 3000, '[]', 'sold').lastInsertRowid);
  const pkg = Number(first.db.prepare(`INSERT INTO packages (name,total_price,description,status) VALUES (?,?,?,?)`).run('test sælgeaftale', 4500, 'behold', 'sold').lastInsertRowid);
  first.db.prepare('INSERT INTO package_vehicles (package_id,vehicle_id) VALUES (?,?)').run(pkg, v1);
  first.db.prepare('INSERT INTO package_vehicles (package_id,vehicle_id) VALUES (?,?)').run(pkg, v2);
  const orderId = Number(first.db.prepare(`INSERT INTO orders (dealer_id,package_id,kind,status,price,item_label,agreement) VALUES (?,?,?,?,?,?,?)`).run(dealerId, pkg, 'buy', 'confirmed', 4500, 'Parti: test sælgeaftale', agreement).lastInsertRowid);
  first.db.prepare('INSERT INTO order_vehicles (order_id,vehicle_id) VALUES (?,?)').run(orderId, v1);
  first.db.prepare('INSERT INTO order_vehicles (order_id,vehicle_id) VALUES (?,?)').run(orderId, v2);
  const snapshot = {
    vehicles: first.db.prepare('SELECT id, vin, make, model, price, images, status FROM vehicles ORDER BY id').all(),
    packages: first.db.prepare('SELECT id, name, total_price, description, status FROM packages ORDER BY id').all(),
    packageVehicles: first.db.prepare('SELECT package_id, vehicle_id FROM package_vehicles ORDER BY package_id, vehicle_id').all(),
    orders: first.db.prepare('SELECT id, dealer_id, vehicle_id, package_id, kind, status, price, item_label, agreement FROM orders ORDER BY id').all(),
    orderVehicles: first.db.prepare('SELECT order_id, vehicle_id FROM order_vehicles ORDER BY order_id, vehicle_id').all(),
    dealer: first.db.prepare(`SELECT email, name, role, status, company_name, cvr, city FROM users WHERE email='old-dealer@example.test'`).get(),
  };
  first.close();
  const second = createApp({ dbFile, uploadDir: path.join(dir, 'up'), env: {}, noTimer: true, rateLimit: false });
  try {
    assert.equal(second.db.prepare('SELECT COUNT(*) n FROM vehicle_images').get().n, 0);
    assert.deepEqual(second.db.prepare('SELECT id, vin, make, model, price, images, status FROM vehicles ORDER BY id').all(), snapshot.vehicles);
    assert.deepEqual(second.db.prepare('SELECT id, name, total_price, description, status FROM packages ORDER BY id').all(), snapshot.packages);
    assert.deepEqual(second.db.prepare('SELECT package_id, vehicle_id FROM package_vehicles ORDER BY package_id, vehicle_id').all(), snapshot.packageVehicles);
    assert.deepEqual(second.db.prepare('SELECT id, dealer_id, vehicle_id, package_id, kind, status, price, item_label, agreement FROM orders ORDER BY id').all(), snapshot.orders);
    assert.deepEqual(second.db.prepare('SELECT order_id, vehicle_id FROM order_vehicles ORDER BY order_id, vehicle_id').all(), snapshot.orderVehicles);
    assert.deepEqual(second.db.prepare(`SELECT email, name, role, status, company_name, cvr, city FROM users WHERE email='old-dealer@example.test'`).get(), snapshot.dealer);
    assert.equal(second.db.prepare('SELECT images FROM vehicles WHERE id=?').get(v1).images, images);
    assert.equal(second.db.prepare('SELECT agreement FROM orders WHERE id=?').get(orderId).agreement, agreement);
    second.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('old-admin@example.test', 'Admin', hashPassword('Old-Admin-Pass-1'));
    const live = await listen(second);
    try {
      const admin = await login(live.base, 'old-admin@example.test', 'Old-Admin-Pass-1');
      const seen = await send(live.base, 'GET', '/api/admin/vehicles/' + v1, admin);
      assert.deepEqual(seen.json.vehicle.images, [A, B]);
      assert.deepEqual(seen.json.vehicle.image_ids, []);
      assert.equal(second.db.prepare('SELECT images FROM vehicles WHERE id=?').get(v1).images, images);
      assert.equal(second.db.prepare('SELECT agreement FROM orders WHERE id=?').get(orderId).agreement, agreement);
    } finally { live.server.close(); }
  } finally { second.close(); }
});

test('only an admin can set a complete image order, and the cover follows it', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'img-admin@example.test', 'Img-Admin-Pass-1');
    const dealer = await login(live.base, 'img-dealer@example.test', 'Img-Dealer-Pass-1');
    const created = await send(live.base, 'POST', '/api/admin/vehicles', admin, { vin: 'IMGVIN000000001', make: 'Test', model: 'En', price: 2500, fuel: 'el', transmission: 'automatic', images: [A, B] });
    assert.equal(created.status, 201);
    const id = created.json.vehicle.id;
    assert.deepEqual(created.json.vehicle.images, [A, B]);
    const ids = created.json.vehicle.image_ids;
    assert.equal(ids.length, 2);
    const price = created.json.vehicle.price;
    const status = created.json.vehicle.status;

    assert.equal((await send(live.base, 'PUT', `/api/admin/vehicles/${id}/images`, '', { image_ids: ids.slice().reverse() })).status, 401);
    assert.equal((await send(live.base, 'PUT', `/api/admin/vehicles/${id}/images`, dealer, { image_ids: ids.slice().reverse() })).status, 403);
    const noHeader = await fetch(live.base + `/api/admin/vehicles/${id}/images`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: admin }, body: JSON.stringify({ image_ids: ids.slice().reverse() }) });
    assert.equal(noHeader.status, 403);

    assert.equal((await send(live.base, 'PUT', `/api/admin/vehicles/${id}/images`, admin, { image_ids: [ids[1]] })).status, 400);
    assert.equal((await send(live.base, 'PUT', `/api/admin/vehicles/${id}/images`, admin, { image_ids: [ids[1], ids[1]] })).status, 400);
    assert.equal((await send(live.base, 'PUT', `/api/admin/vehicles/${id}/images`, admin, { image_ids: [ids[0], 999999] })).status, 400);
    assert.deepEqual(fx.ctx.db.prepare('SELECT url FROM vehicle_images WHERE vehicle_id=? ORDER BY position').all(id).map((r) => r.url), [A, B]);

    const moved = await send(live.base, 'PUT', `/api/admin/vehicles/${id}/images`, admin, { image_ids: [ids[1], ids[0]] });
    assert.equal(moved.status, 200);
    assert.deepEqual(moved.json.vehicle.images, [B, A]);
    assert.equal(moved.json.vehicle.price, price);
    assert.equal(moved.json.vehicle.status, status);
    const shop = await send(live.base, 'GET', '/api/shop/vehicles/' + id, dealer);
    assert.equal(shop.status, 200);
    assert.equal(shop.json.vehicle.images[0], B);
    assert.equal(shop.json.vehicle.image_ids, undefined);

    const saved = await send(live.base, 'PUT', '/api/admin/vehicles/' + id, admin, { ...created.json.vehicle, images: [B, A, C] });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json.vehicle.images, [B, A, C]);
    assert.equal(saved.json.vehicle.image_ids.length, 3);
    assert.equal(saved.json.vehicle.image_ids[2] !== ids[0] && saved.json.vehicle.image_ids[2] !== ids[1], true);
  } finally { live.server.close(); fx.ctx.close(); }

  const again = createApp({ dbFile: fx.dbFile, uploadDir: path.join(fx.dir, 'up'), env: {}, noTimer: true, rateLimit: false });
  try {
    assert.deepEqual(again.db.prepare('SELECT url FROM vehicle_images ORDER BY position').all().map((r) => r.url), [B, A, C]);
    assert.equal(again.db.prepare('SELECT price, status FROM vehicles').get().status, 'available');
  } finally { again.close(); }
});

test('the edit form marks the first image and moves it only in the browser until save', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(src, /Hovedbillede/);
  assert.match(src, /data-up=/);
  assert.match(src, /data-down=/);
  assert.match(src, /images\.push\(j\.url\)/);
  assert.match(src, /Rækkefølgen gemmes først, når du trykker Gem bil/);
});
