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

test('existing image lists get a stable position without losing urls', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-imgmig-'));
  const dbFile = path.join(dir, 't.sqlite');
  const first = createApp({ dbFile, uploadDir: path.join(dir, 'up'), env: {}, noTimer: true, rateLimit: false });
  first.db.prepare(`INSERT INTO vehicles (vin,make,model,price,images) VALUES (?,?,?,?,?)`).run('MIGVIN000000001', 'M', 'M', 1000, JSON.stringify([A, B]));
  first.close();
  const second = createApp({ dbFile, uploadDir: path.join(dir, 'up'), env: {}, noTimer: true, rateLimit: false });
  try {
    const rows = second.db.prepare('SELECT url, position FROM vehicle_images ORDER BY position').all();
    assert.deepEqual(rows.map((r) => r.position), [1, 2]);
    assert.deepEqual(rows.map((r) => r.url), [A, B]);
    assert.equal(second.db.prepare('SELECT images FROM vehicles').get().images, JSON.stringify([A, B]));
  } finally { second.close(); }
  const third = createApp({ dbFile, uploadDir: path.join(dir, 'up'), env: {}, noTimer: true, rateLimit: false });
  try {
    assert.deepEqual(third.db.prepare('SELECT url FROM vehicle_images ORDER BY position').all().map((r) => r.url), [A, B]);
  } finally { third.close(); }
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
