'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { hashPassword, verifyPassword } = require('../src/auth');
const { loadBootstrapConfig } = require('../src/runtime-config');

const PW = 'Bootstrap-Test-Pass-1';
const PW2 = 'Rotated-Bootstrap-Pass-2';
const EMAIL = 'boot@example.test';

function tmpApp(env, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-boot-'));
  const lines = [];
  const ctx = createApp({
    dbFile: path.join(dir, 't.sqlite'),
    uploadDir: path.join(dir, 'up'),
    env,
    noTimer: true,
    rateLimit: false,
    bootstrapLog: true,
    logger: {
      log: (m) => lines.push(String(m)),
      error: (m) => lines.push(String(m)),
    },
    ...extra,
  });
  return { dir, ctx, lines };
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
  const json = await r.json();
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { status: r.status, json, cookie };
}

test('fresh startup creates no admin and does not invent a password', () => {
  const { ctx, lines } = tmpApp({});
  try {
    assert.equal(ctx.bootstrap.reason, 'not-configured');
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
    assert.equal(lines.join('\n').includes(PW), false);
  } finally { ctx.close(); }
});

test('incomplete, weak, and placeholder bootstrap values create nobody', () => {
  for (const env of [
    { BOOTSTRAP_ADMIN_EMAIL: EMAIL },
    { BOOTSTRAP_ADMIN_PASSWORD: PW },
    { BOOTSTRAP_ADMIN_EMAIL: EMAIL, BOOTSTRAP_ADMIN_PASSWORD: 'abc' },
    { BOOTSTRAP_ADMIN_EMAIL: EMAIL, BOOTSTRAP_ADMIN_PASSWORD: 'password123' },
    { BOOTSTRAP_ADMIN_EMAIL: 'not-an-email', BOOTSTRAP_ADMIN_PASSWORD: PW },
  ]) {
    const { ctx } = tmpApp(env);
    try {
      assert.notEqual(ctx.bootstrap.reason, 'created');
      assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
    } finally { ctx.close(); }
  }
});

test('bootstrap creates one admin, and a later startup does not reset the hash', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-boot-'));
  const dbFile = path.join(dir, 't.sqlite');
  const uploadDir = path.join(dir, 'up');
  const lines = [];
  const logger = { log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) };
  const first = createApp({ dbFile, uploadDir, env: { BOOTSTRAP_ADMIN_EMAIL: EMAIL, BOOTSTRAP_ADMIN_PASSWORD: PW, BOOTSTRAP_ADMIN_NAME: 'Boot' }, noTimer: true, rateLimit: false, bootstrapLog: true, logger });
  assert.equal(first.bootstrap.reason, 'created');
  const row = first.db.prepare('SELECT * FROM users').get();
  assert.equal(row.email, EMAIL);
  assert.equal(row.role, 'admin');
  assert.equal(row.status, 'approved');
  assert.match(row.password_hash, /^scrypt\$/);
  assert.equal(row.password_hash.includes(PW), false);
  assert.equal(verifyPassword(PW, row.password_hash), true);
  const hash = row.password_hash;
  first.db.prepare(`INSERT INTO vehicles (vin,make,model,price) VALUES ('DEMOKEEP00000001','Keep','Model',1000)`).run();
  first.close();

  const secondLines = [];
  const second = createApp({
    dbFile, uploadDir,
    env: { BOOTSTRAP_ADMIN_EMAIL: EMAIL, BOOTSTRAP_ADMIN_PASSWORD: PW2 },
    noTimer: true, rateLimit: false, bootstrapLog: true,
    logger: { log: (m) => secondLines.push(String(m)), error: (m) => secondLines.push(String(m)) },
  });
  try {
    assert.equal(second.bootstrap.reason, 'admin-exists');
    const again = second.db.prepare('SELECT password_hash FROM users WHERE email=?').get(EMAIL);
    assert.equal(again.password_hash, hash);
    assert.equal(second.db.prepare(`SELECT COUNT(*) AS n FROM vehicles WHERE vin='DEMOKEEP00000001'`).get().n, 1);
    assert.match(secondLines.join('\n'), /skipped/i);
    assert.equal(secondLines.join('\n').includes(PW), false);
    assert.equal(secondLines.join('\n').includes(PW2), false);
    assert.equal(secondLines.join('\n').includes(EMAIL), false);
    const { server, base } = await listen(second);
    try {
      assert.equal((await login(base, EMAIL, PW2)).status, 401);
      assert.equal((await login(base, EMAIL, PW)).status, 200);
    } finally { server.close(); }
  } finally { second.close(); }
  assert.equal(lines.join('\n').includes(PW), false);
});

test('a changed password and inserted inventory survive a restart that still has the bootstrap secret', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-rot-'));
  const dbFile = path.join(dir, 't.sqlite');
  const uploadDir = path.join(dir, 'up');
  const env = { BOOTSTRAP_ADMIN_EMAIL: EMAIL, BOOTSTRAP_ADMIN_PASSWORD: PW };
  const first = createApp({ dbFile, uploadDir, env, noTimer: true, rateLimit: false });
  const { server, base } = await listen(first);
  const session = await login(base, EMAIL, PW);
  assert.equal(session.status, 200);
  const created = await fetch(base + '/api/admin/vehicles', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b', cookie: session.cookie },
    body: JSON.stringify({ vin: 'KEEPVIN000000001', make: 'Keep', model: 'One', price: 222000, fuel: 'diesel', transmission: 'manual' }),
  });
  assert.equal(created.status, 201);
  const changed = await fetch(base + '/api/auth/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b', cookie: session.cookie },
    body: JSON.stringify({ current_password: PW, new_password: PW2 }),
  });
  assert.equal(changed.status, 200);
  const hash = first.db.prepare('SELECT password_hash FROM users WHERE email=?').get(EMAIL).password_hash;
  server.close();
  first.close();

  const second = createApp({ dbFile, uploadDir, env, noTimer: true, rateLimit: false });
  try {
    assert.equal(second.db.prepare('SELECT password_hash FROM users WHERE email=?').get(EMAIL).password_hash, hash);
    assert.equal(second.db.prepare(`SELECT price FROM vehicles WHERE vin='KEEPVIN000000001'`).get().price, 222000);
    const live = await listen(second);
    try {
      assert.equal((await login(live.base, EMAIL, PW)).status, 401);
      const again = await login(live.base, EMAIL, PW2);
      assert.equal(again.status, 200);
      const list = await fetch(live.base + '/api/admin/vehicles?q=KEEPVIN000000001', { headers: { cookie: again.cookie } });
      const body = await list.json();
      assert.equal(body.count, 1);
    } finally { live.server.close(); }
  } finally { second.close(); }
});

test('bootstrap does not take over an existing non-admin email or rewrite its hash', () => {
  const { ctx } = tmpApp({});
  const dealerHash = hashPassword('Dealer-existing-pass-1');
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'dealer','pending')`).run(EMAIL, 'Dealer', dealerHash);
  ctx.close();
  const dir = ctx; // closed
  void dir;
  const nextDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-taken-'));
  // Re-open the same file by repeating the insert path via a dedicated file.
  const dbFile = path.join(nextDir, 't.sqlite');
  const uploadDir = path.join(nextDir, 'up');
  const seeded = createApp({ dbFile, uploadDir, env: {}, noTimer: true, rateLimit: false });
  seeded.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'dealer','pending')`).run(EMAIL, 'Dealer', dealerHash);
  seeded.close();
  const lines = [];
  const again = createApp({
    dbFile, uploadDir,
    env: { BOOTSTRAP_ADMIN_EMAIL: EMAIL, BOOTSTRAP_ADMIN_PASSWORD: PW },
    noTimer: true, rateLimit: false, bootstrapLog: true,
    logger: { log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) },
  });
  try {
    assert.equal(again.bootstrap.reason, 'email-taken');
    const row = again.db.prepare('SELECT role, status, password_hash FROM users WHERE email=?').get(EMAIL);
    assert.equal(row.role, 'dealer');
    assert.equal(row.status, 'pending');
    assert.equal(row.password_hash, dealerHash);
    assert.equal(again.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role='admin'`).get().n, 0);
    assert.equal(lines.join('\n').includes(PW), false);
  } finally { again.close(); }
});

test('secrets file is the only bootstrap source when SECRETS_FILE is set', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-sec-'));
  const file = path.join(dir, 'secrets.env');
  fs.writeFileSync(file, `BOOTSTRAP_ADMIN_EMAIL=${EMAIL}\nBOOTSTRAP_ADMIN_PASSWORD="${PW}"\nBOOTSTRAP_ADMIN_NAME=From File\n`, { mode: 0o600 });
  const cfg = loadBootstrapConfig({
    SECRETS_FILE: file,
    BOOTSTRAP_ADMIN_EMAIL: 'env-should-not-win@example.test',
    BOOTSTRAP_ADMIN_PASSWORD: 'Environment-Should-Not-Apply-9',
  });
  assert.equal(cfg.BOOTSTRAP_ADMIN_EMAIL, EMAIL);
  assert.equal(cfg.BOOTSTRAP_ADMIN_PASSWORD, PW);
  assert.equal(cfg.BOOTSTRAP_ADMIN_NAME, 'From File');

  fs.chmodSync(file, 0o644);
  assert.throws(() => loadBootstrapConfig({ SECRETS_FILE: file }), /too open/);
  fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, `BOOTSTRAP_ADMIN_EMAIL=${EMAIL}\nBOOTSTRAP_ADMIN_PASSWORD=${PW}\nEXTRA=not-a-secret-value\n`, { mode: 0o600 });
  assert.throws(() => loadBootstrapConfig({ SECRETS_FILE: file }), /EXTRA/);
  const dirPath = path.join(dir, 'subdir');
  fs.mkdirSync(dirPath);
  assert.throws(() => loadBootstrapConfig({ SECRETS_FILE: dirPath }), /regular file/);
});

test('bootstrap module never updates users', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bootstrap-admin.js'), 'utf8');
  assert.doesNotMatch(src, /UPDATE\s+users/i);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'ensure-admins.js')), false);
});
