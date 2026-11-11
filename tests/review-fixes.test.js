'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { assertSecretsOwner, assertLoopbackHost } = require('../src/runtime-config');

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-fix-'));
  const uploadDir = path.join(dir, 'up');
  const ctx = createApp({
    dbFile: path.join(dir, 't.sqlite'), uploadDir, noTimer: true, rateLimit: false,
    env: { SELLER_LEGAL_NAME: 'Test Sælger', SELLER_CVR: '12345678', SELLER_ADDRESS: 'Testvej 1, 8000 Aarhus' },
  });
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'admin','approved',?,?,?)`)
    .run('fix-admin@example.test', 'Admin', hashPassword('Fix-Admin-Pass-1'), 'Admin', null, null);
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`)
    .run('fix-dealer@example.test', 'Dealer', hashPassword('Fix-Dealer-Pass-1'), 'Dealer ApS', '33445566', 'Aarhus');
  return { dir, uploadDir, ctx };
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
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

test('empty lot cannot be created or bought', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'fix-admin@example.test', 'Fix-Admin-Pass-1');
    const dealer = await login(live.base, 'fix-dealer@example.test', 'Fix-Dealer-Pass-1');
    const created = await fetch(live.base + '/api/admin/packages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b', cookie: admin },
      body: JSON.stringify({ name: 'Tomt parti', total_price: 10, vehicle_ids: [] }),
    });
    assert.equal(created.status, 400);
    fx.ctx.db.prepare(`INSERT INTO packages (name,total_price,description) VALUES ('Legacy tom', 10, '')`).run();
    const id = fx.ctx.db.prepare(`SELECT id FROM packages WHERE name='Legacy tom'`).get().id;
    const buy = await fetch(live.base + `/api/shop/packages/${id}/buy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b', cookie: dealer },
      body: '{}',
    });
    assert.equal(buy.status, 409);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
    const listed = await fetch(live.base + '/api/shop/packages', { headers: { cookie: dealer } });
    assert.equal((await listed.json()).packages.some((p) => p.id === id), false);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('upload symlink and missing file are not served as 200 or 500', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'fix-admin@example.test', 'Fix-Admin-Pass-1');
    const outside = path.join(fx.dir, 'outside.txt');
    fs.writeFileSync(outside, 'OUTSIDE-BYTES');
    const name = 'ab'.repeat(16) + '.png';
    fs.symlinkSync(outside, path.join(fx.uploadDir, name));
    const linkRes = await fetch(live.base + '/uploads/' + name, { headers: { cookie: admin } });
    const linkBody = await linkRes.text();
    assert.equal(linkRes.status, 404);
    assert.equal(linkBody.includes('OUTSIDE-BYTES'), false);
    const missing = await fetch(live.base + '/uploads/' + 'cd'.repeat(16) + '.png', { headers: { cookie: admin } });
    assert.equal(missing.status, 404);
    assert.notEqual(missing.status, 500);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = await fetch(live.base + '/api/admin/uploads', {
      method: 'POST',
      headers: { 'x-requested-with': 'autob2b', 'content-type': 'application/octet-stream', cookie: admin },
      body: png,
    });
    assert.equal(up.status, 201);
    const url = (await up.json()).url;
    const ok = await fetch(live.base + url, { headers: { cookie: admin } });
    assert.equal(ok.status, 200);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('malformed cookie does not crash the process', async () => {
  const fx = boot();
  const live = await listen(fx.ctx);
  try {
    const me = await fetch(live.base + '/api/me', { headers: { cookie: 'sid=%' } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user, null);
    const health = await fetch(live.base + '/api/health', { headers: { cookie: 'sid=%' } });
    assert.equal(health.status, 200);
    const admin = await fetch(live.base + '/api/admin/stats', { headers: { cookie: 'sid=%' } });
    assert.equal(admin.status, 401);
  } finally { live.server.close(); fx.ctx.close(); }
});

test('secrets file owner must be the process user', () => {
  assert.throws(() => assertSecretsOwner({ uid: 1000 }, 0), /owned by the user running AutoB2B/);
  assert.doesNotThrow(() => assertSecretsOwner({ uid: 0 }, 0));
  assert.throws(() => assertLoopbackHost('localhost'), /127\.0\.0\.1/);
  assert.throws(() => assertLoopbackHost('::1'), /127\.0\.0\.1/);
  assert.throws(() => assertLoopbackHost('0.0.0.0'), /127\.0\.0\.1/);
  assert.doesNotThrow(() => assertLoopbackHost('127.0.0.1'));
  const start = fs.readFileSync(path.join(__dirname, '..', 'start.sh'), 'utf8');
  assert.match(start, /ENFORCE_LOOPBACK/);
  assert.match(start, /REQUIRE_ADMIN/);
});

test('archive path check ignores gitkeep and the example secrets file', () => {
  const runbook = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'RUNBOOK.md'), 'utf8');
  const names = runbook.match(/grep -E '([^']+)'/g).map((s) => s.slice(9, -1));
  assert.ok(names.length >= 2);
  const [mainPat, uploadPat] = names;
  const main = new RegExp(mainPat);
  const upload = new RegExp(uploadPat);
  const keep = new RegExp('(^|/)uploads/\\.gitkeep$');
  const safe = ['autob2b/.gitignore', 'autob2b/data/.gitkeep', 'autob2b/deploy/secrets.env.example', 'autob2b/uploads/.gitkeep', 'autob2b/src/app.js'];
  const unsafe = ['autob2b/node_modules/express/index.js', 'autob2b/.git/config', 'autob2b/data/autob2b.sqlite', 'autob2b/secrets.env', 'autob2b/ADMIN_LOGIN.txt', 'autob2b/src/LOGIN-INFO.txt', 'autob2b/uploads/abc.png'];
  for (const line of safe) {
    const hit = main.test(line) || (upload.test(line) && !keep.test(line));
    assert.equal(hit, false, line);
  }
  for (const line of unsafe) {
    const hit = main.test(line) || (upload.test(line) && !keep.test(line));
    assert.equal(hit, true, line);
  }
});
