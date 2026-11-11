'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const PW = 'Boot-Server-Password-1';
const NEXT = 'Boot-Server-Password-2';
const EMAIL = 'server-boot@example.test';

function secretFile(dir, body) {
  const file = path.join(dir, 'secrets.env');
  fs.writeFileSync(file, body, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

function start(env) {
  const out = { text: '' };
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('startup timeout')), 20000);
    const onExit = (code) => {
      clearTimeout(timer);
      const err = new Error('server exited ' + code);
      err.output = out.text;
      reject(err);
    };
    child.once('close', onExit);
    const onData = (buf) => {
      out.text += buf.toString();
      const m = out.text.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (!m) return;
      clearTimeout(timer);
      child.removeListener('close', onExit);
      resolve(Number(m[1]));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
  return { child, ready, out };
}

function stop(child) {
  return new Promise((resolve) => {
    child.once('close', (code) => resolve(code));
    child.kill('SIGTERM');
  });
}

function assertSecretFree(text) {
  assert.equal(text.includes(PW), false, 'server output contained the bootstrap secret');
  assert.equal(text.includes(NEXT), false, 'server output contained the rotated secret');
  assert.equal(text.includes('Environment-Should-Not-Apply-9'), false, 'server output contained the unused environment secret');
}

function listenAddresses(port) {
  const hexPort = port.toString(16).toUpperCase().padStart(4, '0');
  const found = [];
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const local = parts[1].toUpperCase();
      if (!local.endsWith(':' + hexPort) || parts[3].toUpperCase() !== '0A') continue;
      found.push(local.split(':')[0]);
    }
  }
  return found;
}

test('production entrypoint binds loopback, bootstraps once, and keeps a changed password across restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-srv-'));
  const file = secretFile(dir, `BOOTSTRAP_ADMIN_EMAIL=${EMAIL}\nBOOTSTRAP_ADMIN_PASSWORD=${PW}\nBOOTSTRAP_ADMIN_NAME=Server Boot\n`);
  const dbFile = path.join(dir, 'app.sqlite');
  const uploadDir = path.join(dir, 'up');
  const env = {
    HOST: '127.0.0.1',
    PORT: '0',
    COOKIE_SECURE: '1',
    TRUST_PROXY: 'loopback',
    ENFORCE_LOOPBACK: '1',
    REQUIRE_ADMIN: '1',
    DB_FILE: dbFile,
    UPLOAD_DIR: uploadDir,
    SECRETS_FILE: file,
    BOOTSTRAP_ADMIN_EMAIL: 'env-should-not-win@example.test',
    BOOTSTRAP_ADMIN_PASSWORD: 'Environment-Should-Not-Apply-9',
  };
  const first = start(env);
  const port = await first.ready;
  try {
    assertSecretFree(first.out.text);
    const addrs = listenAddresses(port);
    assert.ok(addrs.length >= 1, 'expected a listen socket on port ' + port);
    for (const ip of addrs) {
      assert.notEqual(ip, '00000000');
      assert.ok(ip === '0100007F' || ip === '00000000000000000000000000000001' || ip.endsWith('0100007F'), ip);
    }
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
    const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b' },
      body: JSON.stringify({ email: EMAIL, password: PW }),
    });
    assert.equal(login.status, 200);
    const set = (typeof login.headers.getSetCookie === 'function' ? login.headers.getSetCookie() : [login.headers.get('set-cookie')]).join(';');
    assert.match(set, /Secure/i);
    const cookie = set.split(';')[0];
    const decoy = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b' },
      body: JSON.stringify({ email: 'env-should-not-win@example.test', password: 'Environment-Should-Not-Apply-9' }),
    });
    assert.equal(decoy.status, 401);
    const car = await fetch(`http://127.0.0.1:${port}/api/admin/vehicles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b', cookie },
      body: JSON.stringify({ vin: 'SERVERVIN0000001', make: 'Persist', model: 'One', price: 180000, fuel: 'el', transmission: 'automatic' }),
    });
    assert.equal(car.status, 201);
    const rotated = await fetch(`http://127.0.0.1:${port}/api/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b', cookie },
      body: JSON.stringify({ current_password: PW, new_password: NEXT }),
    });
    assert.equal(rotated.status, 200);
  } finally {
    assert.equal(await stop(first.child), 0);
  }
  assertSecretFree(first.out.text);

  const second = start(env);
  const port2 = await second.ready;
  try {
    assertSecretFree(second.out.text);
    assert.match(second.out.text, /skipped/i);
    const oldLogin = await fetch(`http://127.0.0.1:${port2}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b' },
      body: JSON.stringify({ email: EMAIL, password: PW }),
    });
    assert.equal(oldLogin.status, 401);
    const fresh = await fetch(`http://127.0.0.1:${port2}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b' },
      body: JSON.stringify({ email: EMAIL, password: NEXT }),
    });
    assert.equal(fresh.status, 200);
    const cookie = (fresh.headers.get('set-cookie') || '').split(';')[0];
    const list = await fetch(`http://127.0.0.1:${port2}/api/admin/vehicles?q=SERVERVIN0000001`, { headers: { cookie } });
    const body = await list.json();
    assert.equal(body.count, 1);
    assert.equal(body.vehicles[0].price, 180000);
  } finally {
    assert.equal(await stop(second.child), 0);
  }
  assertSecretFree(second.out.text);
});

test('entrypoint refuses a public bind, a world-readable secrets file, and a missing admin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-refuse-'));
  const dbFile = path.join(dir, 'nope.sqlite');
  const openFile = secretFile(dir, `BOOTSTRAP_ADMIN_EMAIL=${EMAIL}\nBOOTSTRAP_ADMIN_PASSWORD=${PW}\n`);
  fs.chmodSync(openFile, 0o644);
  const tooOpen = start({
    HOST: '127.0.0.1', PORT: '0', ENFORCE_LOOPBACK: '1', REQUIRE_ADMIN: '1',
    DB_FILE: dbFile, UPLOAD_DIR: path.join(dir, 'up'), SECRETS_FILE: openFile,
  });
  await assert.rejects(tooOpen.ready, (err) => {
    assert.match(err.output, /too open/);
    assert.equal(err.output.includes(PW), false);
    return true;
  });
  assert.equal(fs.existsSync(dbFile), false);

  const trust = start({ HOST: '127.0.0.1', PORT: '0', TRUST_PROXY: 'true', ENFORCE_LOOPBACK: '1' });
  await assert.rejects(trust.ready, (err) => /loopback/.test(err.output));

  const pub = start({ HOST: '0.0.0.0', PORT: '0', ENFORCE_LOOPBACK: '1', DB_FILE: dbFile });
  await assert.rejects(pub.ready, (err) => /loopback address/.test(err.output));
  assert.equal(fs.existsSync(dbFile), false);
});
