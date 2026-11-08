'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-ag-'));
  const ctx = createApp({ dbFile: path.join(dir, 't.sqlite'), uploadDir: path.join(dir, 'up'), env: {}, noTimer: true, rateLimit: false });
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('ag-admin@example.test', 'Admin', hashPassword('Agreement-Admin-1'));
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('ag-dealer@example.test', 'Dealer', hashPassword('Agreement-Dealer-1'), 'Testforhandler', '11223344', 'Aarhus');
  return ctx;
}
async function listen(ctx) {
  const server = await new Promise((resolve) => ctx.app.listen(0, '127.0.0.1', function () { resolve(this); }));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
async function login(base, email, password) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b' }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200);
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function json(base, method, url, cookie, body) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await r.json();
  assert.ok(r.ok, payload.error || String(r.status));
  return payload;
}
const car = (vin, price) => ({ vin, make: 'Test', model: vin, price, fuel: 'el', transmission: 'automatic' });

test('single car agreement stays price plus 25 percent VAT', async () => {
  const ctx = boot();
  const live = await listen(ctx);
  try {
    const admin = await login(live.base, 'ag-admin@example.test', 'Agreement-Admin-1');
    const dealer = await login(live.base, 'ag-dealer@example.test', 'Agreement-Dealer-1');
    const v = (await json(live.base, 'POST', '/api/admin/vehicles', admin, car('AGVIN0000000001', 1000))).vehicle;
    const buy = await json(live.base, 'POST', `/api/shop/vehicles/${v.id}/buy`, dealer, {});
    const ag = buy.order.agreement;
    assert.equal(buy.order.price, 1000);
    assert.equal(ag.package_breakdown, undefined);
    assert.equal(ag.price_excl_vat, 1000);
    assert.equal(ag.vat, 250);
    assert.equal(ag.total_incl_vat, 1250);
    assert.equal(ag.items[0].price, 1000);
    assert.equal(ag.seller.name, 'AutoB2B');
    assert.equal(ag.seller.cvr, undefined);
  } finally { live.server.close(); ctx.close(); }
});

test('package agreement explains catalog sum, adjustment, and agreed price without changing the charge', async () => {
  const ctx = boot();
  const live = await listen(ctx);
  try {
    const admin = await login(live.base, 'ag-admin@example.test', 'Agreement-Admin-1');
    const dealer = await login(live.base, 'ag-dealer@example.test', 'Agreement-Dealer-1');
    async function pack(prices, total, name) {
      const ids = [];
      for (let i = 0; i < prices.length; i++) {
        const v = (await json(live.base, 'POST', '/api/admin/vehicles', admin, car(name + String(i).padStart(3, '0'), prices[i]))).vehicle;
        ids.push(v.id);
      }
      const pkg = (await json(live.base, 'POST', '/api/admin/packages', admin, { name, total_price: total, vehicle_ids: ids })).package;
      const buy = await json(live.base, 'POST', `/api/shop/packages/${pkg.id}/buy`, dealer, {});
      assert.equal(buy.order.price, total);
      return buy.order.agreement;
    }
    const discount = await pack([2000, 3000], 4500, 'RABATVIN000000');
    assert.deepEqual(discount.items.map((i) => i.price), [2000, 3000]);
    assert.equal(discount.package_breakdown.catalog_sum, 5000);
    assert.equal(discount.package_breakdown.adjustment, -500);
    assert.equal(discount.package_breakdown.agreed_price, 4500);
    assert.equal(discount.price_excl_vat, 4500);
    assert.equal(discount.vat, 1125);
    assert.equal(discount.total_incl_vat, 5625);

    const extra = await pack([2000, 3000], 5500, 'TILLAEGVIN0000');
    assert.equal(extra.package_breakdown.catalog_sum, 5000);
    assert.equal(extra.package_breakdown.adjustment, 500);
    assert.equal(extra.price_excl_vat, 5500);
    assert.equal(extra.vat, 1375);
    assert.equal(extra.total_incl_vat, 6875);

    const same = await pack([2000, 3000], 5000, 'ENSVIN00000000');
    assert.equal(same.package_breakdown.catalog_sum, 5000);
    assert.equal(same.package_breakdown.adjustment, 0);
    assert.equal(same.price_excl_vat, 5000);
    assert.equal(same.vat, 1250);
    assert.equal(same.total_incl_vat, 6250);

    const rounded = await pack([2, 2], 3, 'RUNDEVIN000000');
    assert.equal(rounded.package_breakdown.catalog_sum, 4);
    assert.equal(rounded.package_breakdown.adjustment, -1);
    assert.equal(rounded.price_excl_vat, 3);
    assert.equal(rounded.vat, 1);
    assert.equal(rounded.total_incl_vat, 4);
  } finally { live.server.close(); ctx.close(); }
});

test('printable agreement names the package adjustment', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(src, /Sum af katalogpriser/);
  assert.match(src, /Prisjustering \(rabat\)/);
  assert.match(src, /Prisjustering \(tillæg\)/);
  assert.match(src, /Aftalt pakkepris ekskl\. moms/);
  assert.match(src, /Katalogpris/);
});
