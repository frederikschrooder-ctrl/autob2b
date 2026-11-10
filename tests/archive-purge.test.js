'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

const SELLER = { SELLER_LEGAL_NAME: 'Højbogaard Biler', SELLER_CVR: '14952705', SELLER_ADDRESS: 'Teknologiparken 4, 9440 Aabybro, Denmark' };
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBAQEA8QDw8PDw8PDw8PDw8PDw8PFREWFhURFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGhAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAABBQEBAAAAAAAAAAAAAAADAAIEBQYHB//EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8A0f/Z', 'base64');

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-purge-'));
  const uploadDir = path.join(dir, 'up');
  const ctx = createApp({ dbFile: path.join(dir, 't.sqlite'), uploadDir, env: SELLER, noTimer: true, rateLimit: false });
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('purge-admin@example.test', 'Admin', hashPassword('Purge-Admin-Pass-1'));
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('purge-dealer@example.test', 'Dealer', hashPassword('Purge-Dealer-Pass-1'), 'Køber', '52334455', 'Aarhus');
  return { dir, uploadDir, ctx };
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
const car = (vin) => ({ vin, make: 'Test', model: vin, price: 2000, fuel: 'el', transmission: 'automatic' });
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

test('delete unsold archived package, car, links and image file', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'purge-admin@example.test', 'Purge-Admin-Pass-1');
    const name = 'cd'.repeat(16) + '.jpg';
    fs.writeFileSync(path.join(fx.uploadDir, name), jpeg);
    const vehicle = (await send(live.base, 'POST', '/api/admin/vehicles', admin, { ...car('PURGEVIN00000001'), images: ['/uploads/' + name] })).json.vehicle;
    const pkg = (await send(live.base, 'POST', '/api/admin/packages', admin, { name: 'Usoldt arkiv', total_price: 2000, vehicle_ids: [vehicle.id] })).json.package;
    fx.ctx.db.prepare('UPDATE packages SET archived_at=? WHERE id=?').run('2026-01-01T00:00:00.000Z', pkg.id);
    const removed = await send(live.base, 'DELETE', '/api/admin/archived/packages/' + pkg.id, admin);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.deleted, true);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM packages').get().n, 0);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM vehicles').get().n, 0);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM package_vehicles').get().n, 0);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM vehicle_images').get().n, 0);
    assert.equal(fs.existsSync(path.join(fx.uploadDir, name)), false);
    assert.equal((await send(live.base, 'GET', '/api/admin/packages?archived=1', admin)).json.packages.length, 0);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('delete unsold archived vehicle and its image file', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'purge-admin@example.test', 'Purge-Admin-Pass-1');
    const name = 'ef'.repeat(16) + '.jpg';
    fs.writeFileSync(path.join(fx.uploadDir, name), jpeg);
    const vehicle = (await send(live.base, 'POST', '/api/admin/vehicles', admin, { ...car('PURGEVIN00000002'), images: ['/uploads/' + name] })).json.vehicle;
    fx.ctx.db.prepare('UPDATE vehicles SET archived_at=? WHERE id=?').run('2026-01-01T00:00:00.000Z', vehicle.id);
    assert.equal((await send(live.base, 'GET', '/api/admin/vehicles?archived=1', admin)).json.vehicles.some((v) => v.id === vehicle.id), true);
    const removed = await send(live.base, 'DELETE', '/api/admin/archived/vehicles/' + vehicle.id, admin);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.deleted, true);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM vehicles WHERE id=?').get(vehicle.id).n, 0);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM vehicle_images').get().n, 0);
    assert.equal(fs.existsSync(path.join(fx.uploadDir, name)), false);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('delete unsold archived order and leave the car for sale', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'purge-admin@example.test', 'Purge-Admin-Pass-1');
    const dealer = await login(live.base, 'purge-dealer@example.test', 'Purge-Dealer-Pass-1');
    const vehicle = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('PURGEVIN00000003'))).json.vehicle;
    const reserved = await send(live.base, 'POST', '/api/shop/vehicles/' + vehicle.id + '/reserve', dealer, {});
    assert.equal(reserved.status, 201);
    const id = reserved.json.order.id;
    assert.equal((await send(live.base, 'POST', '/api/admin/orders/' + id + '/archive', admin, {})).status, 200);
    const removed = await send(live.base, 'DELETE', '/api/admin/archived/orders/' + id, admin);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.deleted, true);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM orders WHERE id=?').get(id).n, 0);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM order_vehicles WHERE order_id=?').get(id).n, 0);
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(vehicle.id).status, 'available');
  } finally { live.server.close(); fx.ctx.close(); }
});

test('sold archived package keeps the agreement and the order row', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'purge-admin@example.test', 'Purge-Admin-Pass-1');
    const dealer = await login(live.base, 'purge-dealer@example.test', 'Purge-Dealer-Pass-1');
    const name = 'ab'.repeat(16) + '.jpg';
    fs.writeFileSync(path.join(fx.uploadDir, name), jpeg);
    const v1 = (await send(live.base, 'POST', '/api/admin/vehicles', admin, { ...car('PURGEVIN00000011'), images: ['/uploads/' + name] })).json.vehicle;
    const v2 = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('PURGEVIN00000012'))).json.vehicle;
    const pkg = (await send(live.base, 'POST', '/api/admin/packages', admin, { name: 'Solgt arkiv', total_price: 4500, vehicle_ids: [v1.id, v2.id] })).json.package;
    const bought = await send(live.base, 'POST', '/api/shop/packages/' + pkg.id + '/buy', dealer, {});
    assert.equal(bought.status, 201);
    const orderId = bought.json.order.id;
    const before = fx.ctx.db.prepare('SELECT agreement, price, status, vehicle_id, package_id FROM orders WHERE id=?').get(orderId);
    assert.equal((await send(live.base, 'DELETE', '/api/admin/packages/' + pkg.id, admin)).json.archived, true);
    const removed = await send(live.base, 'DELETE', '/api/admin/archived/packages/' + pkg.id, admin);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.kept, true);
    assert.match(removed.json.message, /Købsaftalen/);
    const after = fx.ctx.db.prepare('SELECT agreement, price, status, vehicle_id, package_id FROM orders WHERE id=?').get(orderId);
    assert.equal(after.agreement, before.agreement);
    assert.equal(after.price, before.price);
    assert.equal(after.status, before.status);
    assert.equal(after.vehicle_id, before.vehicle_id);
    assert.equal(after.package_id, before.package_id);
    assert.equal(sha(after.agreement), sha(before.agreement));
    const shown = await send(live.base, 'GET', '/api/orders/' + orderId, dealer);
    assert.equal(shown.status, 200);
    assert.equal(shown.json.order.agreement.items.length, 2);
    assert.equal(shown.json.order.agreement.seller.name, 'Højbogaard Biler');
    assert.equal(shown.json.order.agreement.items[0].vin, 'PURGEVIN00000011');
    assert.equal(fx.ctx.db.prepare('SELECT purged_at FROM packages WHERE id=?').get(pkg.id).purged_at == null, false);
    assert.equal((await send(live.base, 'GET', '/api/admin/packages?archived=1', admin)).json.packages.some((p) => p.id === pkg.id), false);
    assert.equal(fx.ctx.db.prepare('SELECT id FROM vehicles WHERE id=?').get(v1.id).id, v1.id);
    assert.equal(fs.existsSync(path.join(fx.uploadDir, name)), false);
    assert.equal((await send(live.base, 'GET', '/api/admin/vehicles', admin)).json.vehicles.some((v) => v.id === v1.id), false);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('sold archived vehicle keeps the agreement and the order reference', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'purge-admin@example.test', 'Purge-Admin-Pass-1');
    const dealer = await login(live.base, 'purge-dealer@example.test', 'Purge-Dealer-Pass-1');
    const name = 'a1'.repeat(16) + '.jpg';
    fs.writeFileSync(path.join(fx.uploadDir, name), jpeg);
    const vehicle = (await send(live.base, 'POST', '/api/admin/vehicles', admin, { ...car('PURGEVIN00000021'), images: ['/uploads/' + name] })).json.vehicle;
    const bought = await send(live.base, 'POST', '/api/shop/vehicles/' + vehicle.id + '/buy', dealer, {});
    assert.equal(bought.status, 201);
    const orderId = bought.json.order.id;
    const before = fx.ctx.db.prepare('SELECT agreement, vehicle_id, price, status FROM orders WHERE id=?').get(orderId);
    fx.ctx.db.prepare('UPDATE vehicles SET archived_at=? WHERE id=?').run('2026-01-02T00:00:00.000Z', vehicle.id);
    const removed = await send(live.base, 'DELETE', '/api/admin/archived/vehicles/' + vehicle.id, admin);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.kept, true);
    assert.match(removed.json.message, /Købsaftalen/);
    const after = fx.ctx.db.prepare('SELECT agreement, vehicle_id, price, status FROM orders WHERE id=?').get(orderId);
    assert.equal(after.agreement, before.agreement);
    assert.equal(after.vehicle_id, vehicle.id);
    assert.equal(after.price, before.price);
    assert.equal(after.status, 'confirmed');
    const shown = await send(live.base, 'GET', '/api/orders/' + orderId, admin);
    assert.equal(shown.status, 200);
    assert.equal(shown.json.order.agreement.items[0].description.includes('Test'), true);
    assert.equal(shown.json.order.agreement.items[0].vin, 'PURGEVIN00000021');
    assert.equal(fx.ctx.db.prepare('SELECT purged_at FROM vehicles WHERE id=?').get(vehicle.id).purged_at == null, false);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM vehicle_images WHERE vehicle_id=?').get(vehicle.id).n, 0);
    assert.equal(fs.existsSync(path.join(fx.uploadDir, name)), false);
    assert.equal((await send(live.base, 'GET', '/api/admin/vehicles?archived=1', admin)).json.vehicles.some((v) => v.id === vehicle.id), false);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('sold archived order keeps the agreement and leaves the archive list', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'purge-admin@example.test', 'Purge-Admin-Pass-1');
    const dealer = await login(live.base, 'purge-dealer@example.test', 'Purge-Dealer-Pass-1');
    const vehicle = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('PURGEVIN00000031'))).json.vehicle;
    const bought = await send(live.base, 'POST', '/api/shop/vehicles/' + vehicle.id + '/buy', dealer, {});
    const orderId = bought.json.order.id;
    const before = fx.ctx.db.prepare('SELECT agreement, price, status, vehicle_id FROM orders WHERE id=?').get(orderId);
    assert.equal((await send(live.base, 'POST', '/api/admin/orders/' + orderId + '/archive', admin, {})).status, 200);
    const removed = await send(live.base, 'DELETE', '/api/admin/archived/orders/' + orderId, admin);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.deleted, false);
    assert.match(removed.json.message, /Købsaftalen er bevaret/);
    const after = fx.ctx.db.prepare('SELECT agreement, price, status, vehicle_id, archived_at, purged_at FROM orders WHERE id=?').get(orderId);
    assert.equal(after.agreement, before.agreement);
    assert.equal(after.price, before.price);
    assert.equal(after.status, before.status);
    assert.equal(after.vehicle_id, vehicle.id);
    assert.equal(after.archived_at == null, false);
    assert.equal(after.purged_at == null, false);
    assert.equal((await send(live.base, 'GET', '/api/admin/orders?archived=1', admin)).json.orders.some((o) => o.id === orderId), false);
    assert.equal((await send(live.base, 'GET', '/api/admin/orders', admin)).json.orders.some((o) => o.id === orderId), false);
    const shown = await send(live.base, 'GET', '/api/orders/' + orderId, dealer);
    assert.equal(shown.status, 200);
    assert.equal(shown.json.order.agreement.number.startsWith('AG-'), true);
    assert.equal((await send(live.base, 'GET', '/api/shop/orders', dealer)).json.orders.some((o) => o.id === orderId), true);
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(vehicle.id).status, 'sold');
  } finally { live.server.close(); fx.ctx.close(); }
});

test('non-archived package, vehicle and order are refused', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'purge-admin@example.test', 'Purge-Admin-Pass-1');
    const dealer = await login(live.base, 'purge-dealer@example.test', 'Purge-Dealer-Pass-1');
    const vehicle = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('PURGEVIN00000041'))).json.vehicle;
    const pkg = (await send(live.base, 'POST', '/api/admin/packages', admin, { name: 'Aktivt', total_price: 2000, vehicle_ids: [vehicle.id] })).json.package;
    const lone = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('PURGEVIN00000042'))).json.vehicle;
    const order = await send(live.base, 'POST', '/api/shop/vehicles/' + lone.id + '/reserve', dealer, {});
    assert.equal(order.status, 201);
    const packageNo = await send(live.base, 'DELETE', '/api/admin/archived/packages/' + pkg.id, admin);
    const vehicleNo = await send(live.base, 'DELETE', '/api/admin/archived/vehicles/' + lone.id, admin);
    const orderNo = await send(live.base, 'DELETE', '/api/admin/archived/orders/' + order.json.order.id, admin);
    assert.equal(packageNo.status, 409);
    assert.equal(vehicleNo.status, 409);
    assert.equal(orderNo.status, 409);
    assert.match(packageNo.json.error, /arkiveret/);
    assert.match(vehicleNo.json.error, /arkiveret/);
    assert.match(orderNo.json.error, /arkiveret/);
    assert.equal(fx.ctx.db.prepare('SELECT archived_at FROM packages WHERE id=?').get(pkg.id).archived_at, null);
    assert.equal(fx.ctx.db.prepare('SELECT id FROM vehicles WHERE id=?').get(lone.id).id, lone.id);
    assert.equal(fx.ctx.db.prepare('SELECT archived_at FROM orders WHERE id=?').get(order.json.order.id).archived_at, null);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM package_vehicles WHERE package_id=?').get(pkg.id).n, 1);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('a dealer cannot purge archived packages, vehicles or orders', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'purge-admin@example.test', 'Purge-Admin-Pass-1');
    const dealer = await login(live.base, 'purge-dealer@example.test', 'Purge-Dealer-Pass-1');
    const vehicle = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('PURGEVIN00000051'))).json.vehicle;
    const pkg = (await send(live.base, 'POST', '/api/admin/packages', admin, { name: 'Lukket', total_price: 2000, vehicle_ids: [vehicle.id] })).json.package;
    const bought = await send(live.base, 'POST', '/api/shop/packages/' + pkg.id + '/buy', dealer, {});
    const orderId = bought.json.order.id;
    assert.equal((await send(live.base, 'DELETE', '/api/admin/packages/' + pkg.id, admin)).json.archived, true);
    assert.equal((await send(live.base, 'POST', '/api/admin/orders/' + orderId + '/archive', admin, {})).status, 200);
    fx.ctx.db.prepare('UPDATE vehicles SET archived_at=? WHERE id=?').run('2026-01-03T00:00:00.000Z', vehicle.id);
    const before = fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(orderId).agreement;
    for (const url of ['/api/admin/archived/packages/' + pkg.id, '/api/admin/archived/vehicles/' + vehicle.id, '/api/admin/archived/orders/' + orderId]) {
      assert.equal((await send(live.base, 'DELETE', url, dealer)).status, 403, url);
      assert.equal((await send(live.base, 'DELETE', url, '')).status, 401, url);
    }
    assert.equal((await send(live.base, 'GET', '/api/admin/packages?archived=1', dealer)).status, 403);
    assert.equal((await send(live.base, 'GET', '/api/admin/vehicles?archived=1', dealer)).status, 403);
    assert.equal(fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(orderId).agreement, before);
    assert.equal(fx.ctx.db.prepare('SELECT purged_at FROM packages WHERE id=?').get(pkg.id).purged_at, null);
    assert.equal(fx.ctx.db.prepare('SELECT id FROM vehicles WHERE id=?').get(vehicle.id).id, vehicle.id);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('opening the database does not purge archived rows or rewrite an agreement', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  let file;
  try {
    const admin = await login(live.base, 'purge-admin@example.test', 'Purge-Admin-Pass-1');
    const dealer = await login(live.base, 'purge-dealer@example.test', 'Purge-Dealer-Pass-1');
    const vehicle = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('PURGEVIN00000061'))).json.vehicle;
    const bought = await send(live.base, 'POST', '/api/shop/vehicles/' + vehicle.id + '/buy', dealer, {});
    const orderId = bought.json.order.id;
    fx.ctx.db.prepare('UPDATE orders SET archived_at=? WHERE id=?').run('2026-01-04T00:00:00.000Z', orderId);
    fx.ctx.db.prepare('UPDATE vehicles SET archived_at=? WHERE id=?').run('2026-01-04T00:00:00.000Z', vehicle.id);
    file = path.join(fx.dir, 't.sqlite');
    const agreement = fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(orderId).agreement;
    live.server.close();
    fx.ctx.close();
    fx.closed = true;
    const again = createApp({ dbFile: file, uploadDir: fx.uploadDir, env: SELLER, noTimer: true, rateLimit: false });
    try {
      const order = again.db.prepare('SELECT agreement, archived_at, purged_at, vehicle_id FROM orders WHERE id=?').get(orderId);
      assert.equal(order.agreement, agreement);
      assert.equal(order.archived_at, '2026-01-04T00:00:00.000Z');
      assert.equal(order.purged_at, null);
      assert.equal(order.vehicle_id, vehicle.id);
      assert.equal(again.db.prepare('SELECT archived_at, purged_at FROM vehicles WHERE id=?').get(vehicle.id).purged_at, null);
    } finally { again.close(); }
  } finally { if (!fx.closed) { live.server.close(); fx.ctx.close(); } }
});

test('Gendan on an archived package or vehicle leaves the agreement and the sale unchanged', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'purge-admin@example.test', 'Purge-Admin-Pass-1');
    const dealer = await login(live.base, 'purge-dealer@example.test', 'Purge-Dealer-Pass-1');
    const v1 = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('PURGEVIN00000071'))).json.vehicle;
    const v2 = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('PURGEVIN00000072'))).json.vehicle;
    const pkg = (await send(live.base, 'POST', '/api/admin/packages', admin, { name: 'Gendan parti', total_price: 3000, vehicle_ids: [v1.id] })).json.package;
    const bought = await send(live.base, 'POST', '/api/shop/packages/' + pkg.id + '/buy', dealer, {});
    assert.equal(bought.status, 201);
    const orderId = bought.json.order.id;
    const before = fx.ctx.db.prepare('SELECT agreement, price, status, package_id FROM orders WHERE id=?').get(orderId);
    assert.equal((await send(live.base, 'DELETE', '/api/admin/packages/' + pkg.id, admin)).json.archived, true);
    assert.equal((await send(live.base, 'POST', '/api/admin/packages/' + pkg.id + '/restore', dealer, {})).status, 403);
    const restored = await send(live.base, 'POST', '/api/admin/packages/' + pkg.id + '/restore', admin, {});
    assert.equal(restored.status, 200);
    assert.equal(fx.ctx.db.prepare('SELECT archived_at, status FROM packages WHERE id=?').get(pkg.id).archived_at, null);
    assert.equal(fx.ctx.db.prepare('SELECT status FROM packages WHERE id=?').get(pkg.id).status, 'sold');
    const after = fx.ctx.db.prepare('SELECT agreement, price, status, package_id FROM orders WHERE id=?').get(orderId);
    assert.equal(after.agreement, before.agreement);
    assert.equal(after.price, before.price);
    assert.equal(after.status, before.status);
    assert.equal(after.package_id, before.package_id);
    fx.ctx.db.prepare('UPDATE vehicles SET archived_at=? WHERE id=?').run('2026-01-05T00:00:00.000Z', v2.id);
    const vehicleBack = await send(live.base, 'POST', '/api/admin/vehicles/' + v2.id + '/restore', admin, {});
    assert.equal(vehicleBack.status, 200);
    assert.equal(fx.ctx.db.prepare('SELECT archived_at, status FROM vehicles WHERE id=?').get(v2.id).archived_at, null);
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(v2.id).status, 'available');
    assert.equal((await send(live.base, 'POST', '/api/admin/vehicles/' + v1.id + '/restore', admin, {})).status, 409);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('archive screens confirm permanent delete and dealers do not get the action', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const shop = src.slice(src.indexOf('async function shopOrders'), src.indexOf('async function agreementPage'));
  assert.match(src, /Er du sikker\? Dette kan ikke fortrydes/);
  assert.match(src, /data-purge-order=/);
  assert.match(src, /data-purge-package=/);
  assert.match(src, /data-purge-vehicle=/);
  assert.match(src, /\/api\/admin\/archived\/orders\//);
  assert.match(src, /\/api\/admin\/archived\/packages\//);
  assert.match(src, /\/api\/admin\/archived\/vehicles\//);
  assert.match(src, /<h2>Arkiv<\/h2>/);
  assert.match(src, /<option value="archived">Arkiv<\/option>/);
  assert.match(src, /archive-actions/);
  assert.match(src, />Gendan<\/button><button[^>]*data-purge-order=[^>]*>Slet permanent<\/button>/);
  assert.match(src, />Gendan<\/button><button[^>]*data-purge-package=[^>]*>Slet permanent<\/button>/);
  assert.match(src, />Gendan<\/button><button[^>]*data-purge-vehicle=[^>]*>Slet permanent<\/button>/);
  assert.match(src, /id="restore">Gendan<\/button><button[^>]*id="purge">Slet permanent<\/button>/);
  assert.equal(shop.includes('Slet permanent'), false);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /\.archive-actions\{display:inline-flex;flex-flow:row nowrap/);
  assert.equal(shop.includes('data-purge'), false);
  assert.equal(shop.includes('/api/admin/archived'), false);
});
