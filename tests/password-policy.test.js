'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createApp } = require('../src/app');
const { isForbiddenPassword, ADMIN_MIN, DEALER_MIN } = require('../src/password-policy');

const ADMIN_EMAIL = 'policy-admin@example.test';
const FOUR = 'k7mq';
const THREE = 'k7m';
const LONGER = 'k7mq-longer-1';
const DEALER_OK = 'dealer1234';
const DEALER_SHORT = 'dealer123';

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

test('admin minimum is 4 or more and dealer minimum stays 10', () => {
  assert.equal(ADMIN_MIN, 4);
  assert.equal(DEALER_MIN, 10);
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

test('every admin can use 4 or more; dealers stay at 10', async () => {
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

    const dealerShort = await post(live.base, '/api/auth/register', { company_name: 'Kort', cvr: '22334455', city: 'Aarhus', phone: '12345678', email: 'dealer-short@example.test', password: FOUR });
    assert.equal(dealerShort.status, 400);
    assert.match(dealerShort.json.error, /10/);
    const dealerNine = await post(live.base, '/api/auth/register', { company_name: 'Kort', cvr: '22334455', city: 'Aarhus', phone: '12345678', email: 'dealer-nine@example.test', password: DEALER_SHORT });
    assert.equal(dealerNine.status, 400);
    const dealer = await post(live.base, '/api/auth/register', { company_name: 'Lang', cvr: '22334456', city: 'Aarhus', phone: '12345678', email: 'dealer-ok@example.test', password: DEALER_OK });
    assert.equal(dealer.status, 201);
    const row = ctx.db.prepare('SELECT id FROM users WHERE email=?').get('dealer-ok@example.test');
    await post(live.base, `/api/admin/dealers/${row.id}/approve`, {}, admin.cookie);
    const dealerSession = await post(live.base, '/api/auth/login', { email: 'dealer-ok@example.test', password: DEALER_OK });
    assert.equal((await (await fetch(live.base + '/api/me', { headers: { cookie: dealerSession.cookie } })).json()).user.password_min_length, 10);
    assert.equal((await post(live.base, '/api/auth/password', { current_password: DEALER_OK, new_password: FOUR }, dealerSession.cookie)).status, 400);
    assert.equal((await post(live.base, '/api/auth/password', { current_password: DEALER_OK, new_password: 'dealer12345' }, dealerSession.cookie)).status, 200);
    for (const password of historicalPasswords()) {
      const denied = await post(live.base, '/api/admin/admins', { email: 'hist-admin@example.test', name: 'Hist', password }, admin.cookie);
      assert.equal(denied.status, 400);
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').get('hist-admin@example.test').n, 0);
    }
  } finally { live.server.close(); ctx.close(); }
});

test('forms keep dealer minimum 10 and admin minimum 4', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(src, /Mindst 10 tegn/);
  assert.match(src, /minlength="10"/);
  assert.match(src, /min\. 4 tegn/);
  assert.match(src, /minlength="4"/);
  assert.match(src, /password_min_length/);
  const denylist = fs.readFileSync(path.join(__dirname, '..', 'src', 'forbidden-password-sha256.txt'), 'utf8');
  assert.equal(denylist.split('\n').filter((line) => /^[0-9a-f]{64}$/.test(line)).length, 2);
  for (const pw of historicalPasswords()) assert.equal(denylist.includes(pw), false);
});
