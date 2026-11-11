'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

const SELLER = { SELLER_LEGAL_NAME: 'Højbogaard Biler', SELLER_CVR: '14952705', SELLER_ADDRESS: 'Teknologiparken 4, 9440 Aabybro, Denmark' };
const OWNER = 'frederik@example.test';
const JAN = 'jan@jan.dk';

function boot(extra = {}, logs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-tiers-'));
  const ctx = createApp({
    dbFile: path.join(dir, 't.sqlite'), uploadDir: path.join(dir, 'up'), noTimer: true, rateLimit: false,
    env: { ...SELLER, BOOTSTRAP_ADMIN_EMAIL: OWNER, HEAD_ADMIN_EMAILS: JAN, ...extra },
    logger: { log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) },
  });
  const add = (email, name, role, status = 'approved') => ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,?,?,?,?,?)`)
    .run(email, name, hashPassword('Tier-Pass-1234'), role, status, name + ' ApS', '10000000', 'Aarhus');
  add(OWNER, 'Frederik', 'admin');
  add(JAN, 'Jan', 'dealer');
  add('regular@example.test', 'Regular', 'admin');
  add('dealer@example.test', 'Dealer', 'dealer');
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
async function login(base, email) {
  const r = await send(base, 'POST', '/api/auth/login', '', { email, password: 'Tier-Pass-1234' });
  assert.equal(r.status, 200, email);
  return r.cookie;
}
function row(ctx, email) {
  return ctx.db.prepare('SELECT role, status, head_admin, password_hash, email FROM users WHERE email=?').get(email);
}

test('startup does not rewrite the owner or Jan, and a dealer Jan still has head-admin access', async () => {
  const logs = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-tier-boot-'));
  const dbFile = path.join(dir, 't.sqlite');
  const first = createApp({ dbFile, uploadDir: path.join(dir, 'up'), env: SELLER, noTimer: true, rateLimit: false });
  const ownerHash = hashPassword('Owner-Pass-1234');
  const janHash = hashPassword('Jan-Pass-1234');
  first.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name) VALUES (?,?,?,'admin','approved',?)`).run(OWNER, 'Frederik', ownerHash, 'Højbogaard');
  first.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name) VALUES (?,?,?,'dealer','approved',?)`).run(JAN, 'Jan', janHash, 'Jan Biler');
  first.close();
  const ctx = createApp({
    dbFile, uploadDir: path.join(dir, 'up2'), noTimer: true, rateLimit: false,
    env: { ...SELLER, BOOTSTRAP_ADMIN_EMAIL: OWNER, HEAD_ADMIN_EMAILS: JAN },
    logger: { log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) },
  });
  const live = await listen(ctx);
  try {
    assert.equal(row(ctx, OWNER).role, 'admin');
    assert.equal(row(ctx, OWNER).password_hash, ownerHash);
    assert.equal(row(ctx, JAN).role, 'dealer');
    assert.equal(row(ctx, JAN).password_hash, janHash);
    assert.equal(row(ctx, JAN).head_admin, null);
    const jan = await send(live.base, 'POST', '/api/auth/login', '', { email: JAN, password: 'Jan-Pass-1234' });
    assert.equal(jan.json.user.tier, 'head');
    assert.equal(jan.json.user.role, 'dealer');
    assert.equal(jan.json.user.staff, true);
    assert.equal((await send(live.base, 'GET', '/api/admin/dealers', jan.cookie)).status, 200);
    const owner = await send(live.base, 'POST', '/api/auth/login', '', { email: OWNER, password: 'Owner-Pass-1234' });
    assert.equal(owner.json.user.tier, 'owner');
    assert.equal(logs.some((line) => /email/i.test(line) && line.includes(OWNER)), false);
  } finally { live.server.close(); ctx.close(); }
});

test('owner, head admin, and regular admin permissions are enforced', async () => {
  const ctx = boot();
  const live = await listen(ctx);
  try {
    const owner = await login(live.base, OWNER);
    const jan = await login(live.base, JAN);
    const regular = await login(live.base, 'regular@example.test');
    const dealer = await login(live.base, 'dealer@example.test');
    const ownerId = ctx.db.prepare('SELECT id FROM users WHERE email=?').get(OWNER).id;
    const janId = ctx.db.prepare('SELECT id FROM users WHERE email=?').get(JAN).id;
    const regularId = ctx.db.prepare('SELECT id FROM users WHERE email=?').get('regular@example.test').id;
    const dealerId = ctx.db.prepare('SELECT id FROM users WHERE email=?').get('dealer@example.test').id;
    const beforeOwner = row(ctx, OWNER);
    const beforeJan = row(ctx, JAN);

    assert.equal((await send(live.base, 'POST', '/api/admin/users/' + ownerId + '/demote', owner, {})).status, 403);
    assert.equal((await send(live.base, 'POST', '/api/admin/users/' + ownerId + '/head', owner, { grant: false })).status, 403);
    assert.equal((await send(live.base, 'POST', '/api/admin/users/' + ownerId + '/demote', jan, {})).status, 403);
    assert.equal((await send(live.base, 'POST', '/api/admin/users/' + ownerId + '/head', jan, { grant: false })).status, 403);
    assert.equal((await send(live.base, 'POST', '/api/admin/users/' + janId + '/demote', jan, {})).status, 403);
    assert.equal((await send(live.base, 'POST', '/api/admin/users/' + janId + '/demote', regular, {})).status, 403);
    assert.equal((await send(live.base, 'POST', '/api/admin/users/' + regularId + '/head', jan, { grant: true })).status, 403);
    assert.equal((await send(live.base, 'POST', '/api/admin/admins', regular, { email: 'new-admin@example.test', name: 'Ny', password: 'New-Admin-1234' })).status, 403);
    assert.equal((await send(live.base, 'POST', '/api/admin/users/' + regularId + '/demote', regular, {})).status, 403);
    assert.equal((await send(live.base, 'POST', '/api/admin/users/' + janId + '/head', dealer, { grant: false })).status, 403);
    assert.equal((await send(live.base, 'POST', `/api/admin/dealers/${janId}/reject`, owner, {})).status, 403);
    assert.deepEqual(row(ctx, OWNER), beforeOwner);
    assert.deepEqual(row(ctx, JAN), beforeJan);
    assert.equal(ctx.db.prepare(`SELECT COUNT(*) n FROM users WHERE email='new-admin@example.test'`).get().n, 0);

    const created = await send(live.base, 'POST', '/api/admin/admins', jan, { email: 'new-admin@example.test', name: 'Ny', password: 'New-Admin-1234' });
    assert.equal(created.status, 201);
    const createdId = created.json.admin.id;
    const demoted = await send(live.base, 'POST', '/api/admin/users/' + createdId + '/demote', jan, {});
    assert.equal(demoted.status, 200);
    assert.equal(row(ctx, 'new-admin@example.test').role, 'dealer');
    assert.equal(row(ctx, OWNER).role, 'admin');
    assert.equal(row(ctx, JAN).role, 'dealer');

    const granted = await send(live.base, 'POST', '/api/admin/users/' + regularId + '/head', owner, { grant: true });
    assert.equal(granted.status, 200);
    assert.equal(granted.json.user.tier, 'head');
    assert.equal(row(ctx, 'regular@example.test').role, 'admin');
    assert.equal(row(ctx, 'regular@example.test').head_admin, 1);
    const revoked = await send(live.base, 'POST', '/api/admin/users/' + regularId + '/head', owner, { grant: false });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.json.user.tier, 'admin');
    const promoted = await send(live.base, 'POST', '/api/admin/users/' + dealerId + '/promote', jan, {});
    assert.equal(promoted.status, 200);
    assert.equal(row(ctx, 'dealer@example.test').role, 'admin');
    assert.equal(row(ctx, 'dealer@example.test').head_admin, null);
  } finally { live.server.close(); ctx.close(); }
});

test('a missing owner config does not lock out an existing admin', async () => {
  const logs = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-tier-safe-'));
  const ctx = createApp({
    dbFile: path.join(dir, 't.sqlite'), uploadDir: path.join(dir, 'up'), noTimer: true, rateLimit: false, env: SELLER,
    logger: { log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) },
  });
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('kept-admin@example.test', 'Kept', hashPassword('Kept-Admin-1234'));
  const live = await listen(ctx);
  try {
    const admin = await send(live.base, 'POST', '/api/auth/login', '', { email: 'kept-admin@example.test', password: 'Kept-Admin-1234' });
    assert.equal(admin.json.user.tier, 'admin');
    assert.equal(admin.json.user.can_manage_admins, true);
    const created = await send(live.base, 'POST', '/api/admin/admins', admin.cookie, { email: 'still-works@example.test', name: 'Still', password: 'Still-Admin-1234' });
    assert.equal(created.status, 201);
    assert.equal(logs.some((line) => /no owner email/i.test(line)), true);
    assert.equal(row(ctx, 'kept-admin@example.test').role, 'admin');
  } finally { live.server.close(); ctx.close(); }
});

test('only a confirmed delete removes a rejected applicant, and every other case is refused', async () => {
  const ctx = boot();
  const live = await listen(ctx);
  try {
    const owner = await login(live.base, OWNER);
    const regular = await login(live.base, 'regular@example.test');
    const dealer = await login(live.base, 'dealer@example.test');
    const insert = (email, status) => {
      ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer',?,?,?,?)`)
        .run(email, email, hashPassword('Tier-Pass-1234'), status, email, String(20000000 + ctx.db.prepare('SELECT COUNT(*) n FROM users').get().n), 'Aarhus');
      return ctx.db.prepare('SELECT * FROM users WHERE email=?').get(email);
    };
    const rejected = insert('afvist@example.test', 'rejected');
    const pending = insert('venter@example.test', 'pending');
    const approved = insert('aktiv@example.test', 'approved');
    const withOrder = insert('ordre@example.test', 'rejected');
    const vehicle = ctx.db.prepare(`INSERT INTO vehicles (vin,make,model,price,images,status) VALUES ('DELVIN0000000001','VW','Golf',1000,'[]','sold')`).run();
    ctx.db.prepare(`INSERT INTO orders (dealer_id,vehicle_id,kind,status,price,item_label,agreement,created_at) VALUES (?,?,'buy','completed',1000,'VW Golf',?,?)`)
      .run(withOrder.id, Number(vehicle.lastInsertRowid), '{"number":"AG-KEEP"}', '2026-11-01T00:00:00.000Z');
    const agreementBefore = ctx.db.prepare('SELECT agreement FROM orders WHERE dealer_id=?').get(withOrder.id).agreement;
    const ownerBefore = row(ctx, OWNER);
    const janBefore = row(ctx, JAN);
    const noConfirm = await send(live.base, 'POST', '/api/admin/dealers/' + rejected.id + '/delete', owner, {});
    assert.equal(noConfirm.status, 400);
    assert.equal(row(ctx, 'afvist@example.test').status, 'rejected');
    assert.equal((await send(live.base, 'POST', '/api/admin/dealers/' + pending.id + '/delete', owner, { confirm: true })).status, 409);
    assert.equal((await send(live.base, 'POST', '/api/admin/dealers/' + approved.id + '/delete', owner, { confirm: true })).status, 409);
    const blockedOrder = await send(live.base, 'POST', '/api/admin/dealers/' + withOrder.id + '/delete', owner, { confirm: true });
    assert.equal(blockedOrder.status, 409);
    assert.equal(ctx.db.prepare('SELECT agreement FROM orders WHERE dealer_id=?').get(withOrder.id).agreement, agreementBefore);
    assert.equal(row(ctx, 'ordre@example.test').email, 'ordre@example.test');
    const janId = ctx.db.prepare('SELECT id FROM users WHERE email=?').get(JAN).id;
    ctx.db.prepare(`UPDATE users SET status='rejected' WHERE id=?`).run(janId);
    assert.equal((await send(live.base, 'POST', '/api/admin/dealers/' + janId + '/delete', owner, { confirm: true })).status, 403);
    ctx.db.prepare(`UPDATE users SET status='approved' WHERE id=?`).run(janId);
    const adminId = ctx.db.prepare('SELECT id FROM users WHERE email=?').get('regular@example.test').id;
    assert.equal((await send(live.base, 'POST', '/api/admin/dealers/' + adminId + '/delete', owner, { confirm: true })).status, 403);
    assert.equal((await send(live.base, 'POST', '/api/admin/dealers/' + rejected.id + '/delete', dealer, { confirm: true })).status, 403);
    assert.deepEqual(row(ctx, OWNER), ownerBefore);
    assert.deepEqual(row(ctx, JAN), janBefore);
    const removed = await send(live.base, 'POST', '/api/admin/dealers/' + rejected.id + '/delete', regular, { confirm: true });
    assert.equal(removed.status, 200);
    assert.equal(ctx.db.prepare('SELECT id FROM users WHERE email=?').get('afvist@example.test'), undefined);
    assert.equal(row(ctx, 'venter@example.test').status, 'pending');
    assert.equal(row(ctx, 'aktiv@example.test').status, 'approved');
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM orders').get().n, 1);
  } finally { live.server.close(); ctx.close(); }
});

test('the user list shows Danish tier badges and does not offer demotion of the owner', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(src, /Ejer/);
  assert.match(src, /Hovedadmin/);
  assert.match(src, /Gør til hovedadmin/);
  assert.match(src, /Fjern hovedadmin/);
  assert.match(src, /Gør til admin/);
  assert.match(src, /Fjern admin/);
  assert.match(src, /Opret admin/);
  assert.match(src, /tier === 'owner'\) return ''/);
  assert.match(src, /data-purge-dealer="\$\{d\.id\}"[^>]*>Slet<\/button>/);
  assert.match(src, /confirm: true/);
  const pendingActs = src.slice(src.indexOf('Afventende Ansøgninger'), src.indexOf('Godkendte Forhandlere'));
  assert.equal(pendingActs.includes('data-purge-dealer'), false);
  const vehicles = src.slice(src.indexOf('async function vehiclesPage'), src.indexOf('async function packagesPage'));
  assert.equal(vehicles.includes('Gør til hovedadmin'), false);
});
