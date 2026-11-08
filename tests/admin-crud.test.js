'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

const SELLER = { SELLER_LEGAL_NAME: 'Test Sælger', SELLER_CVR: '12345678', SELLER_ADDRESS: 'Testvej 1, 8000 Aarhus' };

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-crud-'));
  const ctx = createApp({ dbFile: path.join(dir, 't.sqlite'), uploadDir: path.join(dir, 'up'), env: SELLER, noTimer: true, rateLimit: false });
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('crud-admin@example.test', 'Admin', hashPassword('Crud-Admin-Pass-1'));
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('crud-dealer@example.test', 'Dealer', hashPassword('Crud-Dealer-Pass-1'), 'Køber A/S', '22334455', 'Aarhus');
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('crud-other@example.test', 'Other', hashPassword('Crud-Other-Pass-1'), 'Anden A/S', '22334466', 'Odense');
  return { dir, ctx };
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
const car = (vin, price = 1000) => ({ vin, make: 'Test', model: 'Model', price, fuel: 'el', transmission: 'automatic' });

test('an older orders table gains archive columns without rewriting an agreement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-migrate-'));
  const file = path.join(dir, 'old.sqlite');
  const raw = new DatabaseSync(file);
  raw.exec(`CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    dealer_id INTEGER NOT NULL,
    vehicle_id INTEGER,
    package_id INTEGER,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    price INTEGER NOT NULL,
    item_label TEXT NOT NULL,
    expires_at TEXT,
    agreement TEXT,
    created_at TEXT
  )`);
  const agreement = JSON.stringify({ seller: { name: 'AutoB2B' }, price_excl_vat: 1000, terms: ['Betaling sker efter faktura fra AutoB2B. Levering aftales efter modtaget betaling.'] });
  raw.prepare('INSERT INTO orders (dealer_id,kind,status,price,item_label,agreement) VALUES (1,?,?,?,?,?)').run('buy', 'confirmed', 1000, 'Gammel', agreement);
  raw.close();
  const ctx = createApp({ dbFile: file, uploadDir: path.join(dir, 'up'), env: {}, noTimer: true, rateLimit: false });
  try {
    const cols = ctx.db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
    for (const name of ['admin_note', 'archived_at', 'archived_by', 'archive_note']) assert.ok(cols.includes(name), name);
    assert.ok(ctx.db.prepare("SELECT name FROM sqlite_master WHERE name='order_corrections'").get());
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE id=1').get().agreement, agreement);
  } finally { ctx.close(); }
});

test('order edits, archive, and restore keep the agreement and do not resell a confirmed car', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'crud-admin@example.test', 'Crud-Admin-Pass-1');
    const dealer = await login(live.base, 'crud-dealer@example.test', 'Crud-Dealer-Pass-1');
    const other = await login(live.base, 'crud-other@example.test', 'Crud-Other-Pass-1');
    const anon = await send(live.base, 'PUT', '/api/admin/orders/1', '', { item_label: 'x' });
    assert.equal(anon.status, 401);
    const denied = await send(live.base, 'POST', '/api/admin/orders/1/archive', dealer, {});
    assert.equal(denied.status, 403);
    assert.equal((await send(live.base, 'PUT', '/api/admin/dealers/1', dealer, { company_name: 'X', cvr: '12345678', city: 'A', name: 'A', email: 'x@example.test' })).status, 403);
    assert.equal((await send(live.base, 'POST', '/api/admin/orders/archive-all', admin, {})).status, 404);

    const vehicle = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('CRUDVIN00000001', 4500))).json.vehicle;
    const bought = await send(live.base, 'POST', `/api/shop/vehicles/${vehicle.id}/buy`, dealer, {});
    assert.equal(bought.status, 201);
    const id = bought.json.order.id;
    const before = fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(id).agreement;
    assert.match(before, /Høj|Test Sælger|price_excl_vat/);
    const parsedBefore = JSON.parse(before);

    const badPrice = await send(live.base, 'PUT', '/api/admin/orders/' + id, admin, { item_label: 'Skal rulles tilbage', price: 0, correction_reason: 'nej' });
    assert.equal(badPrice.status, 400);
    assert.equal(fx.ctx.db.prepare('SELECT item_label, price, agreement FROM orders WHERE id=?').get(id).item_label, bought.json.order.item_label);
    assert.equal(fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(id).agreement, before);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) n FROM order_corrections').get().n, 0);

    const missingReason = await send(live.base, 'PUT', '/api/admin/orders/' + id, admin, { price: 4000 });
    assert.equal(missingReason.status, 400);
    const locked = await send(live.base, 'PUT', '/api/admin/orders/' + id, admin, { agreement: { price_excl_vat: 1 }, item_label: 'nej' });
    assert.equal(locked.status, 400);
    assert.equal(fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(id).agreement, before);

    const renamed = await send(live.base, 'PUT', '/api/admin/orders/' + id, admin, { item_label: 'Høj <bil>', admin_note: 'intern note' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.json.order.item_label, 'Høj <bil>');
    assert.equal(renamed.json.order.agreement.price_excl_vat, parsedBefore.price_excl_vat);
    assert.equal(renamed.json.order.agreement.seller.name, parsedBefore.seller.name);
    assert.equal(fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(id).agreement, before);

    const corrected = await send(live.base, 'PUT', '/api/admin/orders/' + id, admin, { price: 4000, correction_reason: 'Aftalt rabat efterfølgende' });
    assert.equal(corrected.status, 200);
    assert.equal(corrected.json.order.price, 4000);
    assert.equal(corrected.json.order.corrections.length, 1);
    assert.equal(corrected.json.order.corrections[0].previous_price, 4500);
    assert.equal(corrected.json.order.agreement.price_excl_vat, 4500);
    assert.equal(fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(id).agreement, before);

    const statsBefore = await send(live.base, 'GET', '/api/admin/stats', admin);
    assert.ok(statsBefore.json.recent_orders.some((o) => o.id === id));
    const archived = await send(live.base, 'POST', '/api/admin/orders/' + id + '/archive', admin, { note: 'fejloprettet' });
    assert.equal(archived.status, 200);
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(vehicle.id).status, 'sold');
    assert.equal(fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(id).agreement, before);
    const list = await send(live.base, 'GET', '/api/admin/orders', admin);
    assert.equal(list.json.orders.some((o) => o.id === id), false);
    const stats = await send(live.base, 'GET', '/api/admin/stats', admin);
    assert.equal(stats.json.recent_orders.some((o) => o.id === id), false);
    assert.equal(stats.json.orders_total, statsBefore.json.orders_total - 1);
    const archive = await send(live.base, 'GET', '/api/admin/orders?archived=1', admin);
    assert.equal(archive.json.orders.some((o) => o.id === id), true);
    assert.equal((await send(live.base, 'POST', `/api/shop/vehicles/${vehicle.id}/buy`, other, {})).status, 409);
    assert.equal((await send(live.base, 'PUT', '/api/admin/vehicles/' + vehicle.id, admin, { ...car('CRUDVIN00000001', 4500), status: 'available' })).status, 409);

    fx.ctx.db.prepare(`UPDATE vehicles SET status='available' WHERE id=?`).run(vehicle.id);
    const refused = await send(live.base, 'POST', '/api/admin/orders/' + id + '/restore', admin, {});
    assert.equal(refused.status, 409);
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(vehicle.id).status, 'available');
    assert.equal(fx.ctx.db.prepare('SELECT archived_at FROM orders WHERE id=?').get(id).archived_at == null, false);
    fx.ctx.db.prepare(`UPDATE vehicles SET status='sold' WHERE id=?`).run(vehicle.id);
    const restored = await send(live.base, 'POST', '/api/admin/orders/' + id + '/restore', admin, {});
    assert.equal(restored.status, 200);
    assert.equal(restored.json.order.archived_at, null);
    assert.equal(restored.json.order.agreement.seller.name, parsedBefore.seller.name);
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(vehicle.id).status, 'sold');
    assert.equal(fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(id).agreement, before);

    const adminRow = fx.ctx.db.prepare(`SELECT role FROM users WHERE email='crud-admin@example.test'`).get();
    assert.equal(adminRow.role, 'admin');
    assert.equal((await send(live.base, 'PUT', '/api/admin/dealers/' + fx.ctx.db.prepare(`SELECT id FROM users WHERE email='crud-admin@example.test'`).get().id, admin, { company_name: 'X', cvr: '12345678', city: 'A', name: 'A', email: 'crud-admin@example.test' })).status, 404);
    assert.equal((await send(live.base, 'DELETE', '/api/admin/admins/1', admin)).status, 404);
    assert.equal(fx.ctx.db.prepare(`SELECT COUNT(*) n FROM users WHERE role='admin'`).get().n, 1);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('archiving a reservation releases it, and a failed restore does not reserve the other car', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'crud-admin@example.test', 'Crud-Admin-Pass-1');
    const dealer = await login(live.base, 'crud-dealer@example.test', 'Crud-Dealer-Pass-1');
    const other = await login(live.base, 'crud-other@example.test', 'Crud-Other-Pass-1');
    const a = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('CRUDVIN00000011'))).json.vehicle;
    const b = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('CRUDVIN00000012'))).json.vehicle;
    const pkg = (await send(live.base, 'POST', '/api/admin/packages', admin, { name: 'To biler', total_price: 1800, vehicle_ids: [a.id, b.id] })).json.package;
    const reserved = await send(live.base, 'POST', `/api/shop/packages/${pkg.id}/reserve`, dealer, {});
    assert.equal(reserved.status, 201);
    const id = reserved.json.order.id;
    assert.equal((await send(live.base, 'POST', '/api/admin/orders/' + id + '/archive', admin, {})).status, 200);
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(a.id).status, 'available');
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(b.id).status, 'available');
    assert.equal(fx.ctx.db.prepare('SELECT status FROM packages WHERE id=?').get(pkg.id).status, 'available');
    const stats = await send(live.base, 'GET', '/api/admin/stats', admin);
    assert.equal(stats.json.recent_orders.some((o) => o.id === id), false);
    const taken = await send(live.base, 'POST', `/api/shop/vehicles/${a.id}/buy`, other, {});
    assert.equal(taken.status, 201);
    const restore = await send(live.base, 'POST', '/api/admin/orders/' + id + '/restore', admin, {});
    assert.equal(restore.status, 409);
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(b.id).status, 'available');
    assert.equal(fx.ctx.db.prepare('SELECT archived_at FROM orders WHERE id=?').get(id).archived_at == null, false);
    assert.equal((await send(live.base, 'DELETE', '/api/admin/packages/' + pkg.id, admin)).status, 409);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('package membership stays consistent and dealer profile edits cannot change role or password', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'crud-admin@example.test', 'Crud-Admin-Pass-1');
    const v1 = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('CRUDVIN00000021'))).json.vehicle;
    const v2 = (await send(live.base, 'POST', '/api/admin/vehicles', admin, car('CRUDVIN00000022'))).json.vehicle;
    const first = await send(live.base, 'POST', '/api/admin/packages', admin, { name: 'Første', total_price: 1500, description: 'a', vehicle_ids: [v1.id] });
    assert.equal(first.status, 201);
    const overlap = await send(live.base, 'POST', '/api/admin/packages', admin, { name: 'Anden', total_price: 1500, vehicle_ids: [v1.id, v2.id] });
    assert.equal(overlap.status, 409);
    const edited = await send(live.base, 'PUT', '/api/admin/packages/' + first.json.package.id, admin, { name: 'Første ø', total_price: 1600, description: 'b', vehicle_ids: [v1.id, v2.id] });
    assert.equal(edited.status, 200);
    assert.equal(edited.json.package.name, 'Første ø');
    assert.equal(edited.json.package.total_price, 1600);
    assert.deepEqual(edited.json.package.vehicles.map((v) => v.id).sort(), [v1.id, v2.id]);

    const dealerId = fx.ctx.db.prepare(`SELECT id FROM users WHERE email='crud-dealer@example.test'`).get().id;
    const hash = fx.ctx.db.prepare('SELECT password_hash FROM users WHERE id=?').get(dealerId).password_hash;
    const roleAttempt = await send(live.base, 'PUT', '/api/admin/dealers/' + dealerId, admin, { company_name: 'Nyt Navn', cvr: '22334455', city: 'Aalborg', name: 'Ny kontakt', email: 'crud-dealer@example.test', role: 'admin', password: 'New-Password-123' });
    assert.equal(roleAttempt.status, 400);
    assert.equal(fx.ctx.db.prepare('SELECT role, password_hash, company_name FROM users WHERE id=?').get(dealerId).role, 'dealer');
    assert.equal(fx.ctx.db.prepare('SELECT password_hash FROM users WHERE id=?').get(dealerId).password_hash, hash);
    const saved = await send(live.base, 'PUT', '/api/admin/dealers/' + dealerId, admin, { company_name: 'Nyt Navn <A/S>', cvr: '22334455', city: 'Aalborg', name: 'Ny kontakt', email: 'crud-dealer@example.test' });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.dealer.company_name, 'Nyt Navn <A/S>');
    assert.equal(saved.json.dealer.password_hash, undefined);
    assert.equal(saved.json.dealer.status, 'approved');
    assert.equal(fx.ctx.db.prepare('SELECT role FROM users WHERE id=?').get(dealerId).role, 'dealer');
    assert.equal((await send(live.base, 'PUT', '/api/admin/dealers/' + dealerId, admin, { company_name: 'X', cvr: '12', city: 'A', name: 'A', email: 'crud-dealer@example.test' })).status, 400);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('order screens name Rediger and Slet and explain archive', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(src, /ordersTable\(s\.recent_orders, 'recent'\)/);
  assert.match(src, /Arkivér ordre #/);
  assert.match(src, /Købsaftalen og prisen i aftalen slettes ikke/);
  assert.match(src, /sætter ikke bilen til salg igen/);
  assert.match(src, /'Rediger'/);
  assert.match(src, />Slet</);
  assert.match(src, /data-archive=/);
  assert.equal(src.includes('password_hash'), false);
});
