'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { resolveTrustProxy } = require('../src/runtime-config');

function cookiesOf(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const one = res.headers.get('set-cookie');
  return one ? [one] : [];
}

async function boot(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-sess-'));
  const ctx = createApp({
    dbFile: path.join(dir, 't.sqlite'),
    uploadDir: path.join(dir, 'up'),
    env: {},
    noTimer: true,
    ...opts,
  });
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('admin@example.test', 'Admin', hashPassword('Session-Admin-Pass-1'));
  const server = await new Promise((resolve) => ctx.app.listen(0, '127.0.0.1', function () { resolve(this); }));
  return { ctx, server, base: `http://127.0.0.1:${server.address().port}`, close: () => { server.close(); ctx.close(); } };
}

test('TRUST_PROXY accepts only loopback', () => {
  assert.equal(resolveTrustProxy(undefined), false);
  assert.equal(resolveTrustProxy(false), false);
  assert.equal(resolveTrustProxy('false'), false);
  assert.equal(resolveTrustProxy('loopback'), 'loopback');
  assert.throws(() => resolveTrustProxy('true'), /loopback/);
  assert.throws(() => resolveTrustProxy('1'), /loopback/);
});

test('session cookie is HttpOnly SameSite=Lax and Secure when requested; logout clears it', async () => {
  const app = await boot({ cookieSecure: true, rateLimit: false });
  try {
    const login = await fetch(app.base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b' },
      body: JSON.stringify({ email: 'admin@example.test', password: 'Session-Admin-Pass-1' }),
    });
    const set = cookiesOf(login).join(';');
    assert.match(set, /sid=/);
    assert.match(set, /HttpOnly/i);
    assert.match(set, /SameSite=Lax/i);
    assert.match(set, /Secure/i);
    assert.match(set, /Path=\//i);
    const body = await login.json();
    assert.equal(JSON.stringify(body).includes('Session-Admin-Pass-1'), false);
    assert.equal(body.user.password_hash, undefined);
    const sid = set.split(';')[0];
    const me = await fetch(app.base + '/api/me', { headers: { cookie: sid } });
    assert.equal((await me.json()).user.role, 'admin');
    const out = await fetch(app.base + '/api/auth/logout', {
      method: 'POST',
      headers: { 'x-requested-with': 'autob2b', cookie: sid },
    });
    const cleared = cookiesOf(out).join(';');
    assert.match(cleared, /Secure/i);
    assert.match(cleared, /HttpOnly/i);
    assert.match(cleared, /SameSite=Lax/i);
    assert.match(cleared, /Expires=Thu, 01 Jan 1970|Max-Age=0/i);
    const after = await fetch(app.base + '/api/me', { headers: { cookie: sid } });
    assert.equal((await after.json()).user, null);
  } finally { app.close(); }
});

test('password change revokes other sessions and keeps the new hash', async () => {
  const app = await boot({ cookieSecure: false, rateLimit: false });
  try {
    async function signIn() {
      const r = await fetch(app.base + '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b' },
        body: JSON.stringify({ email: 'admin@example.test', password: 'Session-Admin-Pass-1' }),
      });
      assert.equal(r.status, 200);
      return (r.headers.get('set-cookie') || '').split(';')[0];
    }
    const first = await signIn();
    const second = await signIn();
    const changed = await fetch(app.base + '/api/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b', cookie: first },
      body: JSON.stringify({ current_password: 'Session-Admin-Pass-1', new_password: 'Session-Admin-Pass-2' }),
    });
    assert.equal(changed.status, 200);
    const replacement = (changed.headers.get('set-cookie') || '').split(';')[0];
    assert.match(replacement, /^sid=/);
    const oldSecond = await fetch(app.base + '/api/me', { headers: { cookie: second } });
    assert.equal((await oldSecond.json()).user, null);
    const kept = await fetch(app.base + '/api/me', { headers: { cookie: replacement } });
    assert.equal((await kept.json()).user.email, 'admin@example.test');
    const oldPw = await fetch(app.base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b' },
      body: JSON.stringify({ email: 'admin@example.test', password: 'Session-Admin-Pass-1' }),
    });
    assert.equal(oldPw.status, 401);
  } finally { app.close(); }
});

test('loopback trust uses X-Forwarded-For; an untrusted proxy ignores it', async () => {
  async function hammer(trustProxy) {
    const app = await boot({ trustProxy, rateLimit: true, cookieSecure: false });
    try {
      const hit = (xff) => fetch(app.base + '/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-requested-with': 'autob2b',
          'x-forwarded-for': xff,
        },
        body: JSON.stringify({ email: 'admin@example.test', password: 'wrong-password' }),
      });
      const statuses = [];
      for (let i = 0; i < 10; i++) statuses.push((await hit('203.0.113.10')).status);
      const eleventh = (await hit('203.0.113.10')).status;
      const other = (await hit('203.0.113.11')).status;
      return { statuses, eleventh, other };
    } finally { app.close(); }
  }
  const trusted = await hammer('loopback');
  assert.ok(trusted.statuses.every((s) => s === 401), JSON.stringify(trusted.statuses));
  assert.equal(trusted.eleventh, 429);
  assert.equal(trusted.other, 401);
  const ignored = await hammer(false);
  assert.equal(ignored.eleventh, 429);
  assert.equal(ignored.other, 429);
});

test('logged-out health is public and catalogue routes stay closed', async () => {
  const app = await boot({ rateLimit: false });
  try {
    const health = await fetch(app.base + '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    for (const url of ['/api/shop/vehicles', '/api/admin/vehicles', '/api/admin/stats', '/api/orders/1']) {
      assert.equal((await fetch(app.base + url)).status, 401, url);
    }
    assert.equal((await fetch(app.base + '/uploads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png')).status, 401);
  } finally { app.close(); }
});
