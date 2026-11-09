'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { isForbiddenPassword, ADMIN_MIN, DEALER_MIN } = require('../src/password-policy');

const ADMIN_EMAIL = 'policy-admin@example.test';
const FOUR = 'k7mq';
const THREE = 'k7m';
const LONGER = 'k7mq-longer-1';
const DEALER_OK = 'dealer1234';

function historicalPasswords() {
  const old = execFileSync('git', ['show', '431e4354233cf8210fbb3f0734b10c7c1f08ac41:src/ensure-admins.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const list = [...old.matchAll(/password:\s*'([^']*)'/g)].map((m) => m[1]);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((p) => p.length).sort((a, b) => a - b), [4, 15]);
  return list;
}

function appWith(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-pw-'));
  const ctx = createApp({ dbFile: path.join(dir, 't.sqlite'), uploadDir: path.join(dir, 'up'), env, noTimer: true, rateLimit: false });
  return ctx;
}

async function listen(ctx) {
  const server = await new Promise((resolve) => ctx.app.listen(0, '127.0.0.1', function () { resolve(this); }));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function post(base, url, body, cookie) {
  const r = await fetch(base + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { /* ignore */ }
  const set = r.headers.get('set-cookie') || '';
  return { status: r.status, json, cookie: set.startsWith('sid=') ? set.split(';')[0] : cookie };
}

test('admin and dealer minimums are 4', () => {
  assert.equal(ADMIN_MIN, 4);
  assert.equal(DEALER_MIN, 4);
  assert.equal(isForbiddenPassword(FOUR), false);
  assert.equal(isForbiddenPassword(LONGER), false);
  for (const pw of historicalPasswords()) assert.equal(isForbiddenPassword(pw), true);
});

test('bootstrap accepts 4 and longer, rejects 3 and both historical passwords', async () => {
  const ok = appWith({ BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD: FOUR });
  assert.equal(ok.bootstrap.reason, 'created');
  const live = await listen(ok);
  try {
    assert.equal((await post(live.base, '/api/auth/login', { email: ADMIN_EMAIL, password: FOUR })).status, 200);
    const me = await fetch(live.base + '/api/me', { headers: { cookie: (await post(live.base, '/api/auth/login', { email: ADMIN_EMAIL, password: FOUR })).cookie } });
    assert.equal((await me.json()).user.password_min_length, 4);
  } finally { live.server.close(); ok.close(); }

  const longer = appWith({ BOOTSTRAP_ADMIN_EMAIL: 'longer-admin@example.test', BOOTSTRAP_ADMIN_PASSWORD: LONGER });
  assert.equal(longer.bootstrap.reason, 'created');
  longer.close();

  const empty = appWith({ BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD: '' });
  try {
    assert.equal(empty.bootstrap.reason, 'incomplete');
    assert.equal(empty.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
  } finally { empty.close(); }
  for (const password of [THREE, 'ab']) {
    const ctx = appWith({ BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD: password });
    try {
      assert.equal(ctx.bootstrap.reason, 'weak-password');
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
    } finally { ctx.close(); }
  }
  for (const password of historicalPasswords()) {
    const ctx = appWith({ BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD: password });
    try {
      assert.equal(ctx.bootstrap.reason, 'weak-password');
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
    } finally { ctx.close(); }
  }
});

test('admin password change accepts 4 and longer, rejects 3 and historical values, and restart keeps the new password', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-rot4-'));
  const dbFile = path.join(dir, 't.sqlite');
  const uploadDir = path.join(dir, 'up');
  const env = { BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD: FOUR };
  const first = createApp({ dbFile, uploadDir, env, noTimer: true, rateLimit: false });
  const live = await listen(first);
  const session = await post(live.base, '/api/auth/login', { email: ADMIN_EMAIL, password: FOUR });
  assert.equal(session.status, 200);
  for (const password of [THREE, ...historicalPasswords()]) {
    const denied = await post(live.base, '/api/auth/password', { current_password: FOUR, new_password: password }, session.cookie);
    assert.equal(denied.status, 400);
    assert.equal(JSON.stringify(denied.json).includes(password), false);
  }
  const changed = await post(live.base, '/api/auth/password', { current_password: FOUR, new_password: LONGER }, session.cookie);
  assert.equal(changed.status, 200);
  live.server.close();
  first.close();

  const second = createApp({ dbFile, uploadDir, env, noTimer: true, rateLimit: false });
  const again = await listen(second);
  try {
    assert.equal(second.bootstrap.reason, 'admin-exists');
    assert.equal((await post(again.base, '/api/auth/login', { email: ADMIN_EMAIL, password: FOUR })).status, 401);
    assert.equal((await post(again.base, '/api/auth/login', { email: ADMIN_EMAIL, password: LONGER })).status, 200);
  } finally { again.server.close(); second.close(); }
});

test('admins and dealers accept 4, reject 3, and an existing dealer can still log in', async () => {
  const ctx = appWith({ BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD: FOUR });
  const live = await listen(ctx);
  try {
    const admin = await post(live.base, '/api/auth/login', { email: ADMIN_EMAIL, password: FOUR });
    const tooShort = await post(live.base, '/api/admin/admins', { email: 'second-admin@example.test', name: 'Second', password: THREE }, admin.cookie);
    assert.equal(tooShort.status, 400);
    const created = await post(live.base, '/api/admin/admins', { email: 'second-admin@example.test', name: 'Second', password: FOUR }, admin.cookie);
    assert.equal(created.status, 201);
    const second = await post(live.base, '/api/auth/login', { email: 'second-admin@example.test', password: FOUR });
    assert.equal(second.status, 200);
    assert.equal((await (await fetch(live.base + '/api/me', { headers: { cookie: second.cookie } })).json()).user.password_min_length, 4);
    const secondDenied = await post(live.base, '/api/auth/password', { current_password: FOUR, new_password: THREE }, second.cookie);
    assert.equal(secondDenied.status, 400);
    const secondOk = await post(live.base, '/api/auth/password', { current_password: FOUR, new_password: LONGER }, second.cookie);
    assert.equal(secondOk.status, 200);

    const dealerThree = await post(live.base, '/api/auth/register', { company_name: 'Kort', cvr: '22334455', city: 'Aarhus', phone: '12345678', email: 'dealer-three@example.test', password: THREE });
    assert.equal(dealerThree.status, 400);
    assert.match(dealerThree.json.error, /4/);
    const dealerFour = await post(live.base, '/api/auth/register', { company_name: 'Fire', cvr: '22334456', city: 'Aarhus', phone: '12345678', email: 'dealer-four@example.test', password: FOUR });
    assert.equal(dealerFour.status, 201);
    const fourRow = ctx.db.prepare('SELECT id FROM users WHERE email=?').get('dealer-four@example.test');
    await post(live.base, `/api/admin/dealers/${fourRow.id}/approve`, {}, admin.cookie);
    const fourSession = await post(live.base, '/api/auth/login', { email: 'dealer-four@example.test', password: FOUR });
    assert.equal(fourSession.status, 200);
    assert.equal((await (await fetch(live.base + '/api/me', { headers: { cookie: fourSession.cookie } })).json()).user.password_min_length, 4);
    assert.equal((await post(live.base, '/api/auth/password', { current_password: FOUR, new_password: THREE }, fourSession.cookie)).status, 400);
    const changedFour = await post(live.base, '/api/auth/password', { current_password: FOUR, new_password: 'w4kq' }, fourSession.cookie);
    assert.equal(changedFour.status, 200);
    assert.equal((await post(live.base, '/api/auth/login', { email: 'dealer-four@example.test', password: 'w4kq' })).status, 200);

    const existingHash = hashPassword(DEALER_OK);
    ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('existing-dealer@example.test', 'Eksisterende', existingHash, 'Gammel', '33445566', 'Aalborg');
    const before = ctx.db.prepare('SELECT password_hash FROM users WHERE email=?').get('existing-dealer@example.test').password_hash;
    const existingLogin = await post(live.base, '/api/auth/login', { email: 'existing-dealer@example.test', password: DEALER_OK });
    assert.equal(existingLogin.status, 200);
    assert.equal(ctx.db.prepare('SELECT password_hash FROM users WHERE email=?').get('existing-dealer@example.test').password_hash, before);
    for (const password of historicalPasswords()) {
      const denied = await post(live.base, '/api/admin/admins', { email: 'hist-admin@example.test', name: 'Hist', password }, admin.cookie);
      assert.equal(denied.status, 400);
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').get('hist-admin@example.test').n, 0);
    }
  } finally { live.server.close(); ctx.close(); }
});

test('registration and password change accept 4 and reject 3 in the client', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(src, /Mindst 4 tegn/);
  assert.match(src, /minlength="4"/);
  assert.doesNotMatch(src, /Mindst 10 tegn/);
  assert.doesNotMatch(src, /minlength="10"/);
  assert.doesNotMatch(src, /length < 10/);
  const registerMin = Number(src.match(/String\(d\.password \|\| ''\)\.length < (\d+)/)[1]);
  const registerMessage = src.match(/throw new Error\('(Adgangskoden skal være mindst \d+ tegn)'\)/)[1];
  assert.equal(registerMin, 4);
  assert.equal(String('abc').length < registerMin ? registerMessage : null, 'Adgangskoden skal være mindst 4 tegn');
  assert.equal(String('abcd').length < registerMin ? registerMessage : null, null);
  const minExpr = src.match(/const minPw = ([^;]+);/)[1];
  const minPw = new Function('S', `return (${minExpr});`)({ user: { role: 'dealer', password_min_length: 4 } });
  assert.equal(minPw, 4);
  assert.equal(new Function('S', `return (${minExpr});`)({ user: { role: 'dealer' } }), 4);
  assert.equal(String('abc').length < minPw, true);
  assert.equal(String('abcd').length < minPw, false);
  assert.match(src, /password_min_length/);
  const denylist = fs.readFileSync(path.join(__dirname, '..', 'src', 'forbidden-password-sha256.txt'), 'utf8');
  assert.equal(denylist.split('\n').filter((line) => /^[0-9a-f]{64}$/.test(line)).length, 2);
  for (const pw of historicalPasswords()) assert.equal(denylist.includes(pw), false);
});
