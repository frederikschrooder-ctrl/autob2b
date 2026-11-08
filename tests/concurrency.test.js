'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

const DEALER_PW = 'Concurrent-Dealer-Pass-1';

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-race-'));
  const dbFile = path.join(dir, 't.sqlite');
  const uploadDir = path.join(dir, 'up');
  const ctx = createApp({
    dbFile, uploadDir, noTimer: true, rateLimit: false,
    env: { SELLER_LEGAL_NAME: 'Test Sælger', SELLER_CVR: '12345678', SELLER_ADDRESS: 'Testvej 1, 8000 Aarhus' },
  });
  return { dir, dbFile, uploadDir, ctx };
}

function addDealer(ctx, email) {
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`)
    .run(email, email, hashPassword(DEALER_PW), email, '10000000', 'Aarhus');
}

function addCar(ctx, vin) {
  const r = ctx.db.prepare(`INSERT INTO vehicles (vin,make,model,price,fuel,transmission) VALUES (?,?,?,?,?,?)`).run(vin, 'Race', vin, 150000, 'diesel', 'manual');
  return Number(r.lastInsertRowid);
}

function buyPair(envA, envB) {
  const worker = path.join(__dirname, 'buy-worker.js');
  function once(env) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [worker], {
        env: {
          PATH: process.env.PATH || '', HOME: process.env.HOME || '',
          SELLER_LEGAL_NAME: 'Test Sælger', SELLER_CVR: '12345678', SELLER_ADDRESS: 'Testvej 1, 8000 Aarhus',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('exit', (code) => {
        if (code !== 0) return reject(new Error('worker exit ' + code + ' ' + err.slice(0, 400)));
        try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('bad worker output')); }
      });
    });
  }
  return Promise.all([once(envA), once(envB)]);
}

test('two processes cannot both buy the same car', async () => {
  const fx = fresh();
  addDealer(fx.ctx, 'a@example.test');
  addDealer(fx.ctx, 'b@example.test');
  const id = addCar(fx.ctx, 'RACEVIN000000001');
  fx.ctx.close();
  const results = await buyPair(
    { DB_FILE: fx.dbFile, UPLOAD_DIR: fx.uploadDir, EMAIL: 'a@example.test', PASSWORD: DEALER_PW, BUY_PATH: `/api/shop/vehicles/${id}/buy` },
    { DB_FILE: fx.dbFile, UPLOAD_DIR: fx.uploadDir, EMAIL: 'b@example.test', PASSWORD: DEALER_PW, BUY_PATH: `/api/shop/vehicles/${id}/buy` },
  );
  const statuses = results.map((r) => r.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409], JSON.stringify(results.map((r) => ({ status: r.status, body: r.body }))));
  const check = createApp({ dbFile: fx.dbFile, uploadDir: fx.uploadDir, env: {}, noTimer: true, rateLimit: false });
  try {
    assert.equal(check.db.prepare('SELECT status FROM vehicles WHERE id=?').get(id).status, 'sold');
    assert.equal(check.db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE kind='buy' AND status='confirmed'`).get().n, 1);
  } finally { check.close(); }
});

test('two processes cannot both buy the same lot', async () => {
  const fx = fresh();
  addDealer(fx.ctx, 'c@example.test');
  addDealer(fx.ctx, 'd@example.test');
  const v1 = addCar(fx.ctx, 'RACEVIN000000011');
  const v2 = addCar(fx.ctx, 'RACEVIN000000012');
  const pkg = Number(fx.ctx.db.prepare(`INSERT INTO packages (name,total_price,description) VALUES ('Race lot',300000,'two')`).run().lastInsertRowid);
  fx.ctx.db.prepare('INSERT INTO package_vehicles (package_id,vehicle_id) VALUES (?,?)').run(pkg, v1);
  fx.ctx.db.prepare('INSERT INTO package_vehicles (package_id,vehicle_id) VALUES (?,?)').run(pkg, v2);
  fx.ctx.close();
  const results = await buyPair(
    { DB_FILE: fx.dbFile, UPLOAD_DIR: fx.uploadDir, EMAIL: 'c@example.test', PASSWORD: DEALER_PW, BUY_PATH: `/api/shop/packages/${pkg}/buy` },
    { DB_FILE: fx.dbFile, UPLOAD_DIR: fx.uploadDir, EMAIL: 'd@example.test', PASSWORD: DEALER_PW, BUY_PATH: `/api/shop/packages/${pkg}/buy` },
  );
  const statuses = results.map((r) => r.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409], JSON.stringify(results.map((r) => ({ status: r.status, body: r.body }))));
  const check = createApp({ dbFile: fx.dbFile, uploadDir: fx.uploadDir, env: {}, noTimer: true, rateLimit: false });
  try {
    assert.equal(check.db.prepare('SELECT status FROM packages WHERE id=?').get(pkg).status, 'sold');
    assert.equal(check.db.prepare('SELECT status FROM vehicles WHERE id=?').get(v1).status, 'sold');
    assert.equal(check.db.prepare('SELECT status FROM vehicles WHERE id=?').get(v2).status, 'sold');
    assert.equal(check.db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE package_id=? AND kind='buy'`).get(pkg).n, 1);
  } finally { check.close(); }
});

test('one process rejects the second simultaneous car purchase', async () => {
  const fx = fresh();
  addDealer(fx.ctx, 'e@example.test');
  addDealer(fx.ctx, 'f@example.test');
  const id = addCar(fx.ctx, 'RACEVIN000000021');
  const server = await new Promise((resolve) => fx.ctx.app.listen(0, '127.0.0.1', function () { resolve(this); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    async function cookie(email) {
      const r = await fetch(base + '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b' },
        body: JSON.stringify({ email, password: DEALER_PW }),
      });
      assert.equal(r.status, 200);
      return (r.headers.get('set-cookie') || '').split(';')[0];
    }
    const [c1, c2] = await Promise.all([cookie('e@example.test'), cookie('f@example.test')]);
    const buy = (cookieHeader) => fetch(base + `/api/shop/vehicles/${id}/buy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b', cookie: cookieHeader },
      body: '{}',
    });
    const [a, b] = await Promise.all([buy(c1), buy(c2)]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    assert.deepEqual(statuses, [201, 409]);
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(id).status, 'sold');
    assert.equal(fx.ctx.db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE kind='buy'`).get().n, 1);
  } finally {
    server.close();
    fx.ctx.close();
  }
});
