'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-'));
let clock = Date.now();
const ctx = createApp({
  dbFile: path.join(tmp, 't.sqlite'), uploadDir: path.join(tmp, 'up'), now: () => clock, noTimer: true, rateLimit: false,
  env: { SELLER_LEGAL_NAME: 'Test Sælger', SELLER_CVR: '12345678', SELLER_ADDRESS: 'Testvej 1, 8000 Aarhus' },
});
let base; let server;
const ADMIN_PW = 'Test-Admin-Pass-123!';

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, headers = {}) {
    const h = { 'x-requested-with': 'autob2b', ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload = body;
    if (body !== undefined && !Buffer.isBuffer(body)) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const r = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0].startsWith('sid=') && sc.includes('sid=;') ? '' : sc.split(';')[0];
    let json = null; try { json = await r.json(); } catch {}
    return { status: r.status, json };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  put(u, b) { return this.req('PUT', u, b); }
  del(u) { return this.req('DELETE', u); }
  async login(email, password) { return this.post('/api/auth/login', { email, password }); }
}
const car = (n, extra = {}) => ({ vin: `TESTVIN${String(n).padStart(10, '0')}`, make: 'Testmærke', model: 'Model' + n, price: 100000 + n, fuel: 'diesel', transmission: 'manual', ...extra });

test.before(async () => {
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('admin@example.test', 'Test Admin', hashPassword(ADMIN_PW));
  await new Promise((r) => { server = ctx.app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); ctx.close(); });

async function adminClient() { const c = new Client(); const r = await c.login('admin@example.test', ADMIN_PW); assert.equal(r.status, 200); return c; }
async function registerDealer(admin, n, approve = true) {
  const email = `dealer${n}@example.test`; const c = new Client();
  const r = await c.post('/api/auth/register', { company_name: 'Forhandler ' + n, cvr: String(10000000 + n), city: 'Aarhus', email, password: 'Dealer-pass-1234' });
  assert.equal(r.status, 201);
  const row = ctx.db.prepare('SELECT * FROM users WHERE email=?').get(email);
  assert.equal(row.status, 'pending'); assert.equal(row.role, 'dealer');
  if (approve === true) assert.equal((await admin.post(`/api/admin/dealers/${row.id}/approve`)).status, 200);
  if (approve === 'reject') assert.equal((await admin.post(`/api/admin/dealers/${row.id}/reject`)).status, 200);
  assert.equal((await c.login(email, 'Dealer-pass-1234')).status, 200);
  return { c, id: row.id, email };
}

test('passwords are hashed (scrypt), never stored in clear', () => {
  const row = ctx.db.prepare('SELECT password_hash FROM users WHERE email=?').get('admin@example.test');
  assert.match(row.password_hash, /^scrypt\$/); assert.ok(!row.password_hash.includes(ADMIN_PW));
});

test('login: wrong password rejected, correct accepted, /api/me', async () => {
  const c = new Client();
  assert.equal((await c.login('admin@example.test', 'wrong')).status, 401);
  assert.equal((await c.get('/api/me')).json.user, null);
  assert.equal((await c.login('admin@example.test', ADMIN_PW)).status, 200);
  const me = await c.get('/api/me'); assert.equal(me.json.user.role, 'admin'); assert.equal(me.json.user.password_hash, undefined);
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/admin/stats')).status, 401);
});

test('admin: add / edit / delete car (+ validation, duplicate VIN, search & filters)', async () => {
  const a = await adminClient();
  const bad = await a.post('/api/admin/vehicles', { make: 'X' });
  assert.equal(bad.status, 400);
  const c1 = await a.post('/api/admin/vehicles', car(1, { fuel: 'el' }));
  assert.equal(c1.status, 201); assert.equal(c1.json.vehicle.status, 'available');
  assert.equal((await a.post('/api/admin/vehicles', car(1))).status, 409);
  assert.equal((await a.post('/api/admin/vehicles', car(2, { fuel: 'kul' }))).status, 400);
  const id = c1.json.vehicle.id;
  const ed = await a.put(`/api/admin/vehicles/${id}`, car(1, { fuel: 'el', price: 123456, color: 'Grøn' }));
  assert.equal(ed.status, 200); assert.equal(ed.json.vehicle.price, 123456); assert.equal(ed.json.vehicle.color, 'Grøn');
  await a.post('/api/admin/vehicles', car(3, { fuel: 'benzin' }));
  assert.equal((await a.get('/api/admin/vehicles?q=Model3')).json.count, 1);
  assert.equal((await a.get('/api/admin/vehicles?q=TESTVIN0000000001')).json.count, 1);
  assert.equal((await a.get('/api/admin/vehicles?fuel=el')).json.count, 1);
  assert.equal((await a.get('/api/admin/vehicles?status=sold')).json.count, 0);
  assert.equal((await a.get('/api/admin/vehicles?q=%25')).json.count, 0); // LIKE wildcard escaped
  assert.equal((await a.del(`/api/admin/vehicles/${id}`)).status, 200);
  assert.equal((await a.get(`/api/admin/vehicles/${id}`)).status, 404);
  assert.equal((await a.del(`/api/admin/vehicles/${id}`)).status, 404);
});

test('admin: image upload accepts real images, rejects others', async () => {
  const a = await adminClient();
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const ok = await a.req('POST', '/api/admin/uploads', png, { 'content-type': 'application/octet-stream' });
  assert.equal(ok.status, 201); assert.match(ok.json.url, /^\/uploads\/[a-f0-9]{32}\.png$/);
  const r = await fetch(base + ok.json.url, { headers: { cookie: a.cookie } }); assert.equal(r.status, 200);
  assert.equal((await fetch(base + ok.json.url)).status, 401);
  const pending = await registerDealer(a, 90, false);
  const dealer = await registerDealer(a, 91);
  assert.equal((await fetch(base + ok.json.url, { headers: { cookie: dealer.c.cookie } })).status, 200);
  assert.equal((await fetch(base + ok.json.url, { headers: { cookie: pending.c.cookie } })).status, 403);
  const notImg = await a.req('POST', '/api/admin/uploads', Buffer.from('<script>alert(1)</script>'.repeat(3)), { 'content-type': 'text/html' });
  assert.equal(notImg.status, 400);
  const withImg = await a.post('/api/admin/vehicles', car(40, { images: [ok.json.url] }));
  assert.equal(withImg.status, 201); assert.deepEqual(withImg.json.vehicle.images, [ok.json.url]);
  assert.equal((await a.post('/api/admin/vehicles', car(41, { images: ['http://evil.example/x.png'] }))).status, 400);
});

test('admin: create parti with selected cars, notifies dealers, delete parti', async () => {
  const a = await adminClient();
  const d = await registerDealer(a, 1);
  const v1 = (await a.post('/api/admin/vehicles', car(10))).json.vehicle;
  const v2 = (await a.post('/api/admin/vehicles', car(11))).json.vehicle;
  assert.equal((await a.post('/api/admin/packages', { name: '', total_price: 5 })).status, 400);
  assert.equal((await a.post('/api/admin/packages', { name: 'P', total_price: 5, vehicle_ids: [999999] })).status, 400);
  const p = await a.post('/api/admin/packages', { name: 'Parti 10', total_price: 190000, description: 'To biler', vehicle_ids: [v1.id, v2.id] });
  assert.equal(p.status, 201); assert.equal(p.json.package.vehicle_count, 2); assert.equal(p.json.package.effective_status, 'available');
  const n = await d.c.get('/api/shop/notifications');
  assert.ok(n.json.notifications.some((x) => x.message.includes('Parti 10')));
  assert.equal((await d.c.get('/api/shop/packages')).json.packages.some((x) => x.id === p.json.package.id), true);
  assert.equal((await a.del(`/api/admin/packages/${p.json.package.id}`)).status, 200);
  assert.equal((await a.get('/api/admin/packages')).json.packages.some((x) => x.id === p.json.package.id), false);
  assert.equal((await a.get(`/api/admin/vehicles/${v1.id}`)).status, 200); // cars survive parti deletion
});

test('dealer: register -> pending blocked -> approve -> reserve -> auto-expire frees car', async () => {
  const a = await adminClient();
  const pending = await registerDealer(a, 2, false);
  assert.equal((await pending.c.get('/api/shop/vehicles')).status, 403);
  assert.equal((await pending.c.get('/api/me')).json.user.status, 'pending');
  const row = ctx.db.prepare('SELECT id FROM users WHERE email=?').get(pending.email);
  await a.post(`/api/admin/dealers/${row.id}/approve`);
  assert.equal((await pending.c.get('/api/shop/vehicles')).status, 200);

  const v = (await a.post('/api/admin/vehicles', car(20))).json.vehicle;
  const r = await pending.c.post(`/api/shop/vehicles/${v.id}/reserve`);
  assert.equal(r.status, 201); assert.equal(r.json.order.status, 'pending'); assert.equal(r.json.order.kind, 'reserve');
  assert.equal((await a.get(`/api/admin/vehicles/${v.id}`)).json.vehicle.status, 'reserved');
  const exp = Date.parse(r.json.order.expires_at) - clock; assert.ok(Math.abs(exp - 24 * 3600 * 1000) < 5000);
  // another dealer cannot take it
  const other = await registerDealer(a, 3);
  assert.equal((await other.c.post(`/api/shop/vehicles/${v.id}/reserve`)).status, 409);
  assert.equal((await other.c.post(`/api/shop/vehicles/${v.id}/buy`)).status, 409);
  assert.equal((await other.c.get(`/api/shop/vehicles/${v.id}`)).status, 404);
  // not expired at 23h
  clock += 23 * 3600 * 1000; ctx.expireOrders();
  assert.equal((await a.get(`/api/admin/vehicles/${v.id}`)).json.vehicle.status, 'reserved');
  // expired at 25h
  clock += 2 * 3600 * 1000; ctx.expireOrders();
  assert.equal((await a.get(`/api/admin/vehicles/${v.id}`)).json.vehicle.status, 'available');
  const orders = await a.get('/api/admin/orders?status=expired');
  assert.ok(orders.json.orders.some((o) => o.id === r.json.order.id));
  assert.equal((await pending.c.get('/api/shop/orders')).json.orders.find((o) => o.id === r.json.order.id).status, 'expired');
  assert.equal((await other.c.post(`/api/shop/vehicles/${v.id}/reserve`)).status, 201); // now free again
});

test('lazy expiry: listing endpoints expire reservations without the timer', async () => {
  const a = await adminClient(); const d = await registerDealer(a, 4);
  const v = (await a.post('/api/admin/vehicles', car(21))).json.vehicle;
  await d.c.post(`/api/shop/vehicles/${v.id}/reserve`);
  clock += 25 * 3600 * 1000;
  assert.equal((await a.get('/api/admin/vehicles?status=available&q=Model21')).json.count, 1);
});

test('dealer: buy now -> order + auto-generated agreement; vehicle sold; ownership enforced', async () => {
  const a = await adminClient(); const d = await registerDealer(a, 5); const other = await registerDealer(a, 6);
  const v = (await a.post('/api/admin/vehicles', car(30, { price: 200000 }))).json.vehicle;
  const b = await d.c.post(`/api/shop/vehicles/${v.id}/buy`);
  assert.equal(b.status, 201); assert.equal(b.json.order.kind, 'buy'); assert.equal(b.json.order.status, 'confirmed');
  const ag = b.json.order.agreement;
  assert.match(ag.number, /^AG-\d{4}-\d{5}$/); assert.equal(ag.price_excl_vat, 200000); assert.equal(ag.vat, 50000); assert.equal(ag.total_incl_vat, 250000);
  assert.equal(ag.seller.name, 'Test Sælger'); assert.equal(ag.seller.cvr, '12345678'); assert.equal(ag.seller.address, 'Testvej 1, 8000 Aarhus');
  assert.equal(ag.buyer.cvr, '10000005'); assert.equal(ag.items[0].vin, v.vin);
  assert.equal((await a.get(`/api/admin/vehicles/${v.id}`)).json.vehicle.status, 'sold');
  const got = await d.c.get(`/api/orders/${b.json.order.id}`); assert.equal(got.status, 200); assert.equal(got.json.order.agreement.number, ag.number);
  assert.equal((await other.c.get(`/api/orders/${b.json.order.id}`)).status, 404);
  assert.equal((await a.get(`/api/orders/${b.json.order.id}`)).status, 200);
  assert.equal((await a.del(`/api/admin/vehicles/${v.id}`)).status, 409); // active order protects car
  assert.equal((await d.c.get('/api/shop/orders')).json.orders.length, 1);
  assert.equal((await other.c.get('/api/shop/orders')).json.orders.length, 0);
});

test('reserve then buy converts own reservation; parti reserve/buy covers all cars', async () => {
  const a = await adminClient(); const d = await registerDealer(a, 7);
  const v = (await a.post('/api/admin/vehicles', car(50))).json.vehicle;
  const r = await d.c.post(`/api/shop/vehicles/${v.id}/reserve`);
  const b = await d.c.post(`/api/shop/vehicles/${v.id}/buy`);
  assert.equal(b.status, 201); assert.equal(b.json.order.id, r.json.order.id); assert.equal(b.json.order.status, 'confirmed'); assert.ok(b.json.order.agreement);
  const v1 = (await a.post('/api/admin/vehicles', car(51))).json.vehicle; const v2 = (await a.post('/api/admin/vehicles', car(52))).json.vehicle;
  const p = (await a.post('/api/admin/packages', { name: 'Parti 51', total_price: 150000, vehicle_vids: [], vehicle_ids: [v1.id, v2.id] })).json.package;
  const pr = await d.c.post(`/api/shop/packages/${p.id}/reserve`);
  assert.equal(pr.status, 201);
  assert.equal((await a.get(`/api/admin/vehicles/${v1.id}`)).json.vehicle.status, 'reserved');
  assert.equal((await d.c.post(`/api/shop/vehicles/${v2.id}/reserve`)).status, 409);
  const pb = await d.c.post(`/api/shop/packages/${p.id}/buy`);
  assert.equal(pb.status, 201); assert.equal(pb.json.order.agreement.items.length, 2);
  assert.equal((await a.get(`/api/admin/vehicles/${v2.id}`)).json.vehicle.status, 'sold');
});

test('admin order actions: confirm / complete / cancel with correct state transitions', async () => {
  const a = await adminClient(); const d = await registerDealer(a, 8);
  const v1 = (await a.post('/api/admin/vehicles', car(60))).json.vehicle; const v2 = (await a.post('/api/admin/vehicles', car(61))).json.vehicle;
  const o1 = (await d.c.post(`/api/shop/vehicles/${v1.id}/reserve`)).json.order;
  assert.equal((await a.post(`/api/admin/orders/${o1.id}/complete`)).status, 409);
  assert.equal((await a.post(`/api/admin/orders/${o1.id}/confirm`)).json.order.status, 'confirmed');
  assert.equal((await a.get(`/api/admin/vehicles/${v1.id}`)).json.vehicle.status, 'sold');
  assert.equal((await a.post(`/api/admin/orders/${o1.id}/complete`)).json.order.status, 'completed');
  assert.equal((await a.post(`/api/admin/orders/${o1.id}/cancel`)).status, 409);
  const o2 = (await d.c.post(`/api/shop/vehicles/${v2.id}/reserve`)).json.order;
  assert.equal((await a.post(`/api/admin/orders/${o2.id}/cancel`)).json.order.status, 'cancelled');
  assert.equal((await a.get(`/api/admin/vehicles/${v2.id}`)).json.vehicle.status, 'available');
  assert.equal((await a.post(`/api/admin/orders/${o2.id}/frobnicate`)).status, 404);
  assert.equal((await a.get('/api/admin/orders?status=completed')).json.orders.some((o) => o.id === o1.id), true);
  assert.equal((await a.get('/api/admin/orders?status=bogus')).status, 400);
  // dealer can cancel own pending reservation
  const o3 = (await d.c.post(`/api/shop/vehicles/${v2.id}/reserve`)).json.order;
  assert.equal((await d.c.post(`/api/shop/orders/${o3.id}/cancel`)).status, 200);
  assert.equal((await a.get(`/api/admin/vehicles/${v2.id}`)).json.vehicle.status, 'available');
});

test('dashboard stats show real numbers', async () => {
  const a = await adminClient();
  const s = (await a.get('/api/admin/stats')).json;
  const cnt = ctx.db.prepare('SELECT COUNT(*) n FROM vehicles').get().n;
  assert.equal(s.vehicles_total, cnt); assert.ok(s.vehicles_total > 0);
  assert.equal(s.orders_total, ctx.db.prepare('SELECT COUNT(*) n FROM orders').get().n);
  assert.ok(s.revenue > 0); assert.ok(Array.isArray(s.recent_orders) && s.recent_orders.length <= 5);
  await registerDealer(a, 9, false);
  assert.ok((await a.get('/api/admin/stats')).json.pending_dealers >= 1);
});

test('rejected dealer is blocked from the catalogue and from buying; also after prior approval', async () => {
  const a = await adminClient();
  const rej = await registerDealer(a, 12, 'reject');
  const v = (await a.post('/api/admin/vehicles', car(70))).json.vehicle;
  for (const u of ['/api/shop/vehicles', `/api/shop/vehicles/${v.id}`, '/api/shop/packages', '/api/shop/orders', '/api/shop/notifications'])
    assert.equal((await rej.c.get(u)).status, 403, u);
  assert.equal((await rej.c.post(`/api/shop/vehicles/${v.id}/reserve`)).status, 403);
  assert.equal((await rej.c.post(`/api/shop/vehicles/${v.id}/buy`)).status, 403);
  assert.equal((await a.get(`/api/admin/vehicles/${v.id}`)).json.vehicle.status, 'available');
  // approved then rejected: live session loses access immediately
  const d = await registerDealer(a, 13);
  assert.equal((await d.c.get('/api/shop/vehicles')).status, 200);
  await a.post(`/api/admin/dealers/${d.id}/reject`);
  assert.equal((await d.c.get('/api/shop/vehicles')).status, 403);
  // unauthenticated
  assert.equal((await new Client().get('/api/shop/vehicles')).status, 401);
});

test('non-admins (dealer, pending, anonymous) are blocked from EVERY admin endpoint', async () => {
  const a = await adminClient();
  const dealer = await registerDealer(a, 14); const pending = await registerDealer(a, 15, false); const anon = new Client();
  const v = (await a.post('/api/admin/vehicles', car(80))).json.vehicle;
  const endpoints = [
    ['GET', '/api/admin/stats'], ['GET', '/api/admin/vehicles'], ['GET', `/api/admin/vehicles/${v.id}`], ['POST', '/api/admin/vehicles', car(81)],
    ['PUT', `/api/admin/vehicles/${v.id}`, car(80)], ['DELETE', `/api/admin/vehicles/${v.id}`], ['POST', '/api/admin/uploads', Buffer.alloc(20)],
    ['GET', '/api/admin/packages'], ['POST', '/api/admin/packages', { name: 'x', total_price: 1 }], ['PUT', '/api/admin/packages/1', { name: 'x', total_price: 1 }], ['DELETE', '/api/admin/packages/1'],
    ['GET', '/api/admin/orders'], ['GET', '/api/admin/orders?archived=1'], ['PUT', '/api/admin/orders/1', { item_label: 'x' }], ['POST', '/api/admin/orders/1/archive', {}], ['POST', '/api/admin/orders/1/restore', {}], ['POST', '/api/admin/orders/1/confirm', {}], ['POST', '/api/admin/orders/1/cancel', {}], ['POST', '/api/admin/orders/1/complete', {}],
    ['GET', '/api/admin/dealers'], ['PUT', '/api/admin/dealers/1', { company_name: 'A', cvr: '12345678', city: 'A', name: 'A', email: 'a@example.test' }], ['POST', `/api/admin/dealers/${pending.id}/approve`, {}], ['POST', `/api/admin/dealers/${pending.id}/reject`, {}],
    ['POST', '/api/admin/admins', { email: 'evil@example.test', name: 'Evil', password: 'Evil-password-123' }],
  ];
  for (const [m, u, b] of endpoints) {
    const call = (c) => (Buffer.isBuffer(b) ? c.req(m, u, b, { 'content-type': 'application/octet-stream' }) : c.req(m, u, b));
    assert.equal((await call(dealer.c)).status, 403, `dealer ${m} ${u}`);
    assert.equal((await call(pending.c)).status, 403, `pending ${m} ${u}`);
    assert.equal((await call(anon)).status, 401, `anon ${m} ${u}`);
  }
  assert.equal(ctx.db.prepare('SELECT status FROM users WHERE id=?').get(pending.id).status, 'pending');
  assert.equal(ctx.db.prepare(`SELECT COUNT(*) n FROM users WHERE email='evil@example.test'`).get().n, 0);
  assert.equal((await a.get(`/api/admin/vehicles/${v.id}`)).status, 200);
});

test('no public admin signup: role/status in register body are ignored; only admin can create admins', async () => {
  const c = new Client();
  const r = await c.post('/api/auth/register', { company_name: 'Sneaky', cvr: '99999999', city: 'X', email: 'sneaky@example.test', password: 'Sneaky-pass-1234', role: 'admin', status: 'approved' });
  assert.equal(r.status, 201);
  const u = ctx.db.prepare('SELECT role,status FROM users WHERE email=?').get('sneaky@example.test');
  assert.deepEqual({ ...u }, { role: 'dealer', status: 'pending' });
  const a = await adminClient();
  const ok = await a.post('/api/admin/admins', { email: 'second@example.test', name: 'Second Admin', password: 'Second-admin-pass-1' });
  assert.equal(ok.status, 201);
  assert.equal(ctx.db.prepare('SELECT role FROM users WHERE email=?').get('second@example.test').role, 'admin');
  assert.equal((await a.post('/api/admin/admins', { email: 'x@example.test', name: 'X', password: 'abc' })).status, 400);
  // registration validation + duplicates
  assert.equal((await c.post('/api/auth/register', { company_name: 'A', cvr: '123', city: 'X', email: 'a@example.test', password: 'Sneaky-pass-1234' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { company_name: 'A', cvr: '12345678', city: 'X', email: 'sneaky@example.test', password: 'Sneaky-pass-1234' })).status, 409);
});

test('CSRF guard: state-changing request without custom header is refused', async () => {
  const a = await adminClient();
  const r = await fetch(base + '/api/admin/vehicles', { method: 'POST', headers: { cookie: a.cookie, 'content-type': 'application/json' }, body: JSON.stringify(car(99)) });
  assert.equal(r.status, 403);
});

test('dealer cannot cancel or read another dealers order; logged-out purchase is refused', async () => {
  const a = await adminClient();
  const d1 = await registerDealer(a, 92);
  const d2 = await registerDealer(a, 93);
  const v = (await a.post('/api/admin/vehicles', car(92))).json.vehicle;
  const order = (await d1.c.post(`/api/shop/vehicles/${v.id}/reserve`)).json.order;
  assert.equal((await d2.c.post(`/api/shop/orders/${order.id}/cancel`)).status, 404);
  assert.equal((await d2.c.get(`/api/orders/${order.id}`)).status, 404);
  assert.equal((await new Client().post(`/api/shop/vehicles/${v.id}/buy`)).status, 401);
  assert.equal((await new Client().post('/api/auth/password', { current_password: 'x', new_password: 'yyyyyyyyyy' })).status, 401);
  assert.equal((await a.get('/api/health')).status, 200);
  assert.deepEqual((await a.get('/api/health')).json, { ok: true });
  assert.equal((await d1.c.get(`/api/shop/orders`)).json.orders.find((o) => o.id === order.id).status, 'pending');
});

test('SPA routes and static assets are served', async () => {
  for (const p of ['/', '/login', '/register', '/dashboard', '/dashboard/vehicles/new', '/shop']) {
    const r = await fetch(base + p); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /html/);
  }
  assert.equal((await fetch(base + '/api/nope')).status, 404);
});
