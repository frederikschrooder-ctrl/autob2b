'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../src/app');
const { openDb } = require('../src/db');
const { hashPassword } = require('../src/auth');

const SELLER = { SELLER_LEGAL_NAME: 'Højbogaard Biler', SELLER_CVR: '14952705', SELLER_ADDRESS: 'Teknologiparken 4, 9440 Aabybro, Denmark' };

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
  const setCookie = r.headers.get('set-cookie') || '';
  return { status: r.status, json, cookie: setCookie.split(';')[0] };
}

test('adding last_seen_at is idempotent and leaves existing user columns unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-seen-old-'));
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
  raw.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city,created_at) VALUES (?,?,?,'dealer','approved',?,?,?,?)`).run('keep@example.test', 'Keep', 'hash-value', 'Gammel A/S', '11111111', 'Aarhus', '2020-01-02T03:04:05.000Z');
  raw.close();
  const first = openDb(file);
  const opened = first.prepare('SELECT * FROM users WHERE email=?').get('keep@example.test');
  assert.equal(opened.last_seen_at, null);
  assert.equal(opened.phone, null);
  assert.equal(opened.email, 'keep@example.test');
  assert.equal(opened.name, 'Keep');
  assert.equal(opened.password_hash, 'hash-value');
  assert.equal(opened.role, 'dealer');
  assert.equal(opened.status, 'approved');
  assert.equal(opened.company_name, 'Gammel A/S');
  assert.equal(opened.cvr, '11111111');
  assert.equal(opened.city, 'Aarhus');
  assert.equal(opened.created_at, '2020-01-02T03:04:05.000Z');
  first.prepare('UPDATE users SET last_seen_at=? WHERE email=?').run('2024-05-06T07:08:09.000Z', 'keep@example.test');
  const stamped = first.prepare('SELECT * FROM users WHERE email=?').get('keep@example.test');
  first.close();
  const second = openDb(file);
  try {
    assert.deepEqual(second.prepare('SELECT * FROM users WHERE email=?').get('keep@example.test'), stamped);
    assert.equal(second.prepare('PRAGMA table_info(users)').all().filter((c) => c.name === 'last_seen_at').length, 1);
  } finally { second.close(); }
});

test('login records last seen, later activity is throttled, and only admins receive it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-seen-'));
  let clock = Date.parse('2026-11-10T18:57:00.000Z');
  const ctx = createApp({ dbFile: path.join(dir, 't.sqlite'), uploadDir: path.join(dir, 'up'), env: SELLER, noTimer: true, rateLimit: false, now: () => clock });
  const live = await listen(ctx);
  try {
    ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city,phone) VALUES (?,?,?,'dealer','approved',?,?,?,?)`).run('seen-dealer@example.test', 'Dealer', hashPassword('Seen-Dealer-Pass-1'), 'Køber A/S', '11223344', 'Aarhus', '12 34 56 78');
    ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('quiet-dealer@example.test', 'Quiet', hashPassword('Quiet-Dealer-Pass-1'), 'Stille A/S', '11223355', 'Odense');
    ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('never-dealer@example.test', 'Never', hashPassword('Never-Dealer-Pass-1'), 'Aldrig A/S', '11223366', 'Aalborg');
    ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('seen-admin@example.test', 'Admin', hashPassword('Seen-Admin-Pass-1'));
    const missed = await send(live.base, 'POST', '/api/auth/login', '', { email: 'seen-dealer@example.test', password: 'wrong-password' });
    assert.equal(missed.status, 401);
    assert.equal(ctx.db.prepare(`SELECT last_seen_at FROM users WHERE email='seen-dealer@example.test'`).get().last_seen_at, null);
    const dealer = await send(live.base, 'POST', '/api/auth/login', '', { email: 'seen-dealer@example.test', password: 'Seen-Dealer-Pass-1' });
    assert.equal(dealer.status, 200);
    assert.equal(Object.hasOwn(dealer.json.user, 'last_seen_at'), false);
    const firstSeen = new Date(clock).toISOString();
    assert.equal(ctx.db.prepare(`SELECT last_seen_at FROM users WHERE email='seen-dealer@example.test'`).get().last_seen_at, firstSeen);
    clock += 60 * 1000;
    const again = await send(live.base, 'POST', '/api/auth/login', '', { email: 'seen-dealer@example.test', password: 'Seen-Dealer-Pass-1' });
    assert.equal(again.status, 200);
    const loginSeen = new Date(clock).toISOString();
    assert.equal(ctx.db.prepare(`SELECT last_seen_at FROM users WHERE email='seen-dealer@example.test'`).get().last_seen_at, loginSeen);
    const before = ctx.db.prepare('SELECT * FROM users WHERE email=?').get('seen-dealer@example.test');
    clock += 4 * 60 * 1000;
    const me = await send(live.base, 'GET', '/api/me', again.cookie);
    assert.equal(me.status, 200);
    assert.equal(Object.hasOwn(me.json.user, 'last_seen_at'), false);
    assert.equal(ctx.db.prepare(`SELECT last_seen_at FROM users WHERE email='seen-dealer@example.test'`).get().last_seen_at, loginSeen);
    clock += 60 * 1000 + 1;
    const active = await send(live.base, 'GET', '/api/shop/vehicles', again.cookie);
    assert.equal(active.status, 200);
    const after = ctx.db.prepare('SELECT * FROM users WHERE email=?').get('seen-dealer@example.test');
    assert.equal(after.last_seen_at, new Date(clock).toISOString());
    const { last_seen_at: beforeSeen, ...beforeRest } = before;
    const { last_seen_at: afterSeen, ...afterRest } = after;
    assert.notEqual(beforeSeen, afterSeen);
    assert.deepEqual(afterRest, beforeRest);
    assert.equal(ctx.db.prepare(`SELECT last_seen_at FROM users WHERE email='never-dealer@example.test'`).get().last_seen_at, null);
    const quiet = await send(live.base, 'POST', '/api/auth/login', '', { email: 'quiet-dealer@example.test', password: 'Quiet-Dealer-Pass-1' });
    assert.equal((await send(live.base, 'GET', '/api/admin/dealers', quiet.cookie)).status, 403);
    const admin = await send(live.base, 'POST', '/api/auth/login', '', { email: 'seen-admin@example.test', password: 'Seen-Admin-Pass-1' });
    const list = await send(live.base, 'GET', '/api/admin/dealers', admin.cookie);
    assert.equal(list.status, 200);
    const shown = list.json.dealers.find((d) => d.email === 'seen-dealer@example.test');
    const silent = list.json.dealers.find((d) => d.email === 'never-dealer@example.test');
    assert.equal(shown.last_seen_at, after.last_seen_at);
    assert.equal(silent.last_seen_at, null);
    assert.equal(JSON.stringify(list.json).includes('seen-admin@example.test'), false);
    const bought = await send(live.base, 'POST', '/api/admin/vehicles', admin.cookie, { vin: 'SEENVIN000000001', make: 'Test', model: 'En', price: 1000, fuel: 'el', transmission: 'automatic' });
    const order = await send(live.base, 'POST', '/api/shop/vehicles/' + bought.json.vehicle.id + '/buy', again.cookie, {});
    assert.equal(order.status, 201);
    const own = await send(live.base, 'GET', '/api/orders/' + order.json.order.id, again.cookie);
    assert.equal(JSON.stringify(own.json).includes('last_seen_at'), false);
    const other = await send(live.base, 'GET', '/api/orders/' + order.json.order.id, quiet.cookie);
    assert.equal(other.status, 404);
    assert.equal(JSON.stringify(other.json).includes('last_seen_at'), false);
    const adminOrder = await send(live.base, 'GET', '/api/orders/' + order.json.order.id, admin.cookie);
    assert.equal(Object.hasOwn(adminOrder.json.order.dealer, 'last_seen_at'), false);
    const shop = await send(live.base, 'GET', '/api/shop/orders', quiet.cookie);
    assert.equal(JSON.stringify(shop.json).includes('last_seen_at'), false);
  } finally { live.server.close(); ctx.close(); }
});

test('the dealers screen names Sidst aktiv and formats Copenhagen time', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const dealers = src.slice(src.indexOf('async function dealersPage'), src.indexOf('function cartIcon'));
  const detail = src.slice(src.indexOf('async function dealerEdit'), src.indexOf('async function profilePage'));
  const shop = src.slice(src.indexOf('function shopShell'), src.indexOf('async function dealerEdit'));
  assert.match(dealers, /<th>Ansøgt<\/th><th>Sidst aktiv<\/th><th>Status<\/th>/);
  assert.match(dealers, /esc\(sidstAktiv\(d\.last_seen_at\)\)/);
  assert.match(dealers, /table class="dealers"/);
  assert.match(dealers, /id="sortseen"/);
  assert.match(detail, /Sidst aktiv: \$\{esc\(sidstAktiv\(d\.last_seen_at\)\)\}/);
  assert.equal(shop.includes('Sidst aktiv'), false);
  assert.equal(shop.includes('last_seen_at'), false);
  const context = { document: { getElementById() { return { innerHTML: '' }; }, addEventListener() {}, querySelector() { return null; } }, window: { addEventListener() {}, scrollTo() {} }, location: { pathname: '/no-such-page' }, history: { pushState() {}, replaceState() {} }, fetch() { return Promise.resolve({ ok: false, status: 500, json: async () => ({}) }); }, Intl, Date, console };
  vm.createContext(context);
  vm.runInContext(src + '\nglobalThis.__seen = sidstAktiv;\n', context);
  assert.equal(context.__seen('2026-11-10T19:57:00.000Z'), '10. nov. 2026 kl. 20:57');
  assert.equal(context.__seen(null), 'Aldrig');
  assert.equal(context.__seen(''), 'Aldrig');
});
