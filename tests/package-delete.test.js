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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-pkgdel-'));
  const uploadDir = path.join(dir, 'up');
  const ctx = createApp({ dbFile: path.join(dir, 't.sqlite'), uploadDir, env: SELLER, noTimer: true, rateLimit: false });
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('pkg-admin@example.test', 'Admin', hashPassword('Pkg-Admin-Pass-1'));
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('pkg-dealer@example.test', 'Dealer', hashPassword('Pkg-Dealer-Pass-1'), 'Køber', '52334455', 'Aarhus');
  return { dir, uploadDir, ctx };
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

test('an unsold package, its cars and its image files are deleted together', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'pkg-admin@example.test', 'Pkg-Admin-Pass-1');
    const name = 'ab'.repeat(16) + '.jpg';
    fs.writeFileSync(path.join(fx.uploadDir, name), jpeg);
    const vehicle = (await send(live.base, 'POST', '/api/admin/vehicles', admin, { ...car('PKGDELVIN0000001'), images: ['/uploads/' + name] })).json.vehicle;
    const pkg = (await send(live.base, 'POST', '/api/admin/packages', admin, { name: 'Usoldt', total_price: 2000, vehicle_ids: [vehicle.id] })).json.package;
    const removed = await send(live.base, 'DELETE', '/api/admin/packages/' + pkg.id, admin);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.archived, false);
    assert.equal((await send(live.base, 'GET', '/api/admin/packages', admin)).json.packages.some((p) => p.id === pkg.id), false);
    assert.equal((await send(live.base, 'GET', '/api/admin/vehicles/' + vehicle.id, admin)).status, 404);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM vehicle_images').get().n, 0);
    assert.equal(fs.existsSync(path.join(fx.uploadDir, name)), false);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('a sold package leaves the list and keeps the agreement fingerprint', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'pkg-admin@example.test', 'Pkg-Admin-Pass-1');
    const dealer = await login(live.base, 'pkg-dealer@example.test', 'Pkg-Dealer-Pass-1');
    const v1 = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('PKGDELVIN0000011'))).json.vehicle;
    const v2 = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('PKGDELVIN0000012'))).json.vehicle;
    const pkg = (await send(live.base, 'POST', '/api/admin/packages', admin, { name: 'test sælgeaftale', total_price: 4500, vehicle_ids: [v1.id, v2.id] })).json.package;
    const bought = await send(live.base, 'POST', `/api/shop/packages/${pkg.id}/buy`, dealer, {});
    assert.equal(bought.status, 201);
    const orderId = bought.json.order.id;
    const before = await send(live.base, 'GET', '/api/orders/' + orderId, dealer);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(before.json.order.agreement)).digest('hex');
    assert.equal(before.json.order.agreement.seller.name, 'Højbogaard Biler');

    const denied = await send(live.base, 'DELETE', '/api/admin/packages/' + pkg.id, dealer);
    assert.equal(denied.status, 403);
    const anon = await send(live.base, 'DELETE', '/api/admin/packages/' + pkg.id, '');
    assert.equal(anon.status, 401);

    const removed = await send(live.base, 'DELETE', '/api/admin/packages/' + pkg.id, admin);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.archived, true);
    assert.equal((await send(live.base, 'GET', '/api/admin/packages', admin)).json.packages.some((p) => p.name === 'test sælgeaftale'), false);
    const after = await send(live.base, 'GET', '/api/orders/' + orderId, admin);
    assert.equal(after.status, 200);
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(after.json.order.agreement)).digest('hex'), fingerprint);
    assert.equal(after.json.order.price, 4500);
    assert.equal(after.json.order.status, 'confirmed');
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(v1.id).status, 'sold');
    assert.equal((await send(live.base, 'POST', `/api/shop/packages/${pkg.id}/buy`, dealer, {})).status, 409);
    assert.equal((await send(live.base, 'DELETE', '/api/admin/vehicles/' + v1.id, admin)).status, 409);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('the package delete screen shows the server error instead of failing quietly', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(src, /Slet partiet "/);
  assert.match(src, /Aftalen og ordren bliver liggende/);
  assert.match(src, /showErr\(msg, err\)/);
  assert.match(src, /msg\.scrollIntoView\(\{ block: 'center' \}\)/);
});
