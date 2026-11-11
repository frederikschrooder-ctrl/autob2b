'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');
const { loadBootstrapConfig } = require('../src/runtime-config');
const { parseSellerIdentity, BUY_CLOSED } = require('../src/seller-identity');

const OWNER = {
  SELLER_LEGAL_NAME: 'Højbogaard Biler',
  SELLER_CVR: '14952705',
  SELLER_ADDRESS: 'Teknologiparken 4, 9440 Aabybro, Denmark',
};
const HOSTILE = {
  SELLER_LEGAL_NAME: 'Høj <"&>\'',
  SELLER_CVR: '14952705',
  SELLER_ADDRESS: 'Teknologiparken 4, 9440 Aabybro æøå',
};

function boot(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-seller-'));
  const ctx = createApp({ dbFile: path.join(dir, 't.sqlite'), uploadDir: path.join(dir, 'up'), env, noTimer: true, rateLimit: false });
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`).run('seller-admin@example.test', 'Admin', hashPassword('Seller-Admin-Pass-1'));
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','approved',?,?,?)`).run('seller-dealer@example.test', 'Dealer', hashPassword('Seller-Dealer-Pass-1'), 'Køber A/S', '22334455', 'Aarhus');
  ctx.db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city) VALUES (?,?,?,'dealer','pending',?,?,?)`).run('seller-pending@example.test', 'Pending', hashPassword('Seller-Pending-Pass-1'), 'Afventer ApS', '22334456', 'Aarhus');
  return { dir, ctx };
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
  assert.equal(r.status, 200);
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function post(base, url, cookie, body) {
  return fetch(base + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'autob2b', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body || {}),
  });
}
const car = (vin, price) => ({ vin, make: 'Test', model: 'Model', price, fuel: 'el', transmission: 'automatic' });

test('seller identity accepts the configured legal name and rejects incomplete or invalid values', () => {
  assert.deepEqual(parseSellerIdentity(OWNER).seller, {
    name: 'Højbogaard Biler',
    cvr: '14952705',
    address: 'Teknologiparken 4, 9440 Aabybro, Denmark',
  });
  assert.equal(parseSellerIdentity({}).ok, false);
  assert.equal(parseSellerIdentity({ ...OWNER, SELLER_LEGAL_NAME: '   ' }).ok, false);
  assert.equal(parseSellerIdentity({ ...OWNER, SELLER_CVR: '' }).ok, false);
  assert.equal(parseSellerIdentity({ ...OWNER, SELLER_CVR: '1495270' }).ok, false);
  assert.equal(parseSellerIdentity({ ...OWNER, SELLER_CVR: '149527055' }).ok, false);
  assert.equal(parseSellerIdentity({ ...OWNER, SELLER_CVR: '1495270A' }).ok, false);
  assert.equal(parseSellerIdentity({ ...OWNER, SELLER_CVR: 'DK14952705' }).ok, false);
  assert.equal(parseSellerIdentity({ ...OWNER, SELLER_ADDRESS: '' }).ok, false);
  assert.equal(parseSellerIdentity({ ...OWNER, SELLER_LEGAL_NAME: 'Høj\nBiler' }).ok, false);
  assert.equal(parseSellerIdentity({ ...OWNER, SELLER_ADDRESS: 'Vej\u0000 1' }).ok, false);
  assert.equal(parseSellerIdentity({ ...OWNER, SELLER_LEGAL_NAME: 'A'.repeat(201) }).ok, false);
  assert.equal(parseSellerIdentity(HOSTILE).seller.name, 'Høj <"&>\'');
  const parsed = parseSellerIdentity(OWNER).seller;
  assert.equal(Object.keys(parsed).join(','), 'name,cvr,address');
});

test('a missing or invalid seller closes buys and leaves reservations in place', async () => {
  const fx = boot({});
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'seller-admin@example.test', 'Seller-Admin-Pass-1');
    const dealer = await login(live.base, 'seller-dealer@example.test', 'Seller-Dealer-Pass-1');
    const pending = await login(live.base, 'seller-pending@example.test', 'Seller-Pending-Pass-1');
    const made = await post(live.base, '/api/admin/vehicles', admin, car('SELLVIN00000001', 1000));
    assert.equal(made.status, 201);
    const id = (await made.json()).vehicle.id;
    const anon = await post(live.base, `/api/shop/vehicles/${id}/buy`);
    assert.equal(anon.status, 401);
    const blocked = await post(live.base, `/api/shop/vehicles/${id}/buy`, pending);
    assert.equal(blocked.status, 403);
    const reserved = await post(live.base, `/api/shop/vehicles/${id}/reserve`, dealer);
    assert.equal(reserved.status, 201);
    const reservationId = (await reserved.json()).order.id;
    const bought = await post(live.base, `/api/shop/vehicles/${id}/buy`, dealer);
    const body = await bought.json();
    assert.equal(bought.status, 503);
    assert.equal(body.error, BUY_CLOSED);
    const row = fx.ctx.db.prepare('SELECT kind, status, agreement FROM orders WHERE id=?').get(reservationId);
    assert.equal(row.kind, 'reserve');
    assert.equal(row.status, 'pending');
    assert.equal(row.agreement, null);
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(id).status, 'reserved');
  } finally { live.server.close(); fx.ctx.close(); }
});

test('an invalid CVR closes a direct buy without creating an order', async () => {
  const fx = boot({ ...OWNER, SELLER_CVR: '1495270' });
  const live = await listen(fx.ctx);
  try {
    const admin = await login(live.base, 'seller-admin@example.test', 'Seller-Admin-Pass-1');
    const dealer = await login(live.base, 'seller-dealer@example.test', 'Seller-Dealer-Pass-1');
    const id = (await (await post(live.base, '/api/admin/vehicles', admin, car('SELLVIN00000002', 1000))).json()).vehicle.id;
    const bought = await post(live.base, `/api/shop/vehicles/${id}/buy`, dealer);
    assert.equal(bought.status, 503);
    assert.equal(fx.ctx.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
    assert.equal(fx.ctx.db.prepare('SELECT status FROM vehicles WHERE id=?').get(id).status, 'available');
  } finally { live.server.close(); fx.ctx.close(); }
});

test('new agreements snapshot the seller, and a later configuration does not rewrite stored agreements', async () => {
  const fx = boot(HOSTILE);
  const live = await listen(fx.ctx);
  const dbFile = path.join(fx.dir, 't.sqlite');
  const uploadDir = path.join(fx.dir, 'up');
  let orderId;
  try {
    const admin = await login(live.base, 'seller-admin@example.test', 'Seller-Admin-Pass-1');
    const dealer = await login(live.base, 'seller-dealer@example.test', 'Seller-Dealer-Pass-1');
    const legacyTerms = [
      'Priserne er engrospriser ekskl. moms. Moms tillægges efter gældende regler.',
      'Køber bekræfter at være en professionel, godkendt forhandler registreret med det angivne CVR-nummer.',
      'Køretøjerne sælges som beskrevet i annoncen og tilstandsrapporten. Sælger er ikke ansvarlig for forhold, der fremgår af rapporten.',
      'Betaling sker efter faktura fra AutoB2B. Levering aftales efter modtaget betaling.',
      'Aftalen er bindende fra det tidspunkt, den er genereret i systemet.',
    ];
    const legacy = JSON.stringify({
      number: 'AG-2020-00001',
      seller: { name: 'AutoB2B' },
      price_excl_vat: 1000,
      vat: 250,
      total_incl_vat: 1250,
      items: [],
      terms: legacyTerms,
    });
    const dealerId = fx.ctx.db.prepare(`SELECT id FROM users WHERE email='seller-dealer@example.test'`).get().id;
    const legacyId = Number(fx.ctx.db.prepare(`INSERT INTO orders (dealer_id,kind,status,price,item_label,agreement) VALUES (?,'buy','confirmed',1000,'Gammel',?)`).run(dealerId, legacy).lastInsertRowid);
    const before = fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(legacyId).agreement;
    const got = await fetch(live.base + '/api/orders/' + legacyId, { headers: { cookie: dealer } });
    assert.equal(got.status, 200);
    const old = (await got.json()).order.agreement;
    assert.equal(old.seller.name, 'AutoB2B');
    assert.equal(old.seller.cvr, undefined);
    assert.equal(old.seller.address, undefined);
    assert.deepEqual(old.terms, legacyTerms);
    assert.equal(fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(legacyId).agreement, before);

    const vehicle = (await (await post(live.base, '/api/admin/vehicles', admin, car('SELLVIN00000003', 1000))).json()).vehicle;
    const bought = await post(live.base, `/api/shop/vehicles/${vehicle.id}/buy`, dealer);
    const payload = await bought.json();
    assert.equal(bought.status, 201);
    const snap = payload.order.agreement;
    orderId = payload.order.id;
    assert.equal(snap.seller.name, HOSTILE.SELLER_LEGAL_NAME);
    assert.equal(snap.seller.cvr, '14952705');
    assert.equal(snap.seller.address, HOSTILE.SELLER_ADDRESS);
    assert.equal(snap.seller.email, undefined);
    assert.equal(snap.seller.phone, undefined);
    assert.equal(snap.terms[3], 'Betaling sker efter faktura fra ' + HOSTILE.SELLER_LEGAL_NAME + '. Levering aftales efter modtaget betaling.');
    assert.equal(snap.terms[4], 'Aftalen er bindende fra det tidspunkt, den er genereret i systemet.');
    assert.equal(snap.price_excl_vat, 1000);
    assert.equal(snap.vat, 250);
    assert.equal(snap.total_incl_vat, 1250);
    assert.equal(snap.package_breakdown, undefined);
    const stored = JSON.parse(fx.ctx.db.prepare('SELECT agreement FROM orders WHERE id=?').get(orderId).agreement);
    assert.equal(stored.seller.name, HOSTILE.SELLER_LEGAL_NAME);
  } finally { live.server.close(); fx.ctx.close(); }

  const next = createApp({ dbFile, uploadDir, env: OWNER, noTimer: true, rateLimit: false });
  try {
    const again = JSON.parse(next.db.prepare('SELECT agreement FROM orders WHERE id=?').get(orderId).agreement);
    assert.equal(again.seller.name, HOSTILE.SELLER_LEGAL_NAME);
    assert.equal(again.seller.address, HOSTILE.SELLER_ADDRESS);
    assert.equal(again.terms[3], 'Betaling sker efter faktura fra ' + HOSTILE.SELLER_LEGAL_NAME + '. Levering aftales efter modtaget betaling.');
    assert.notEqual(again.seller.name, OWNER.SELLER_LEGAL_NAME);
    const legacy = next.db.prepare(`SELECT agreement FROM orders WHERE item_label='Gammel'`).get().agreement;
    const kept = JSON.parse(legacy);
    assert.equal(kept.seller.name, 'AutoB2B');
    assert.equal(kept.terms[3], 'Betaling sker efter faktura fra AutoB2B. Levering aftales efter modtaget betaling.');
  } finally { next.close(); }
});

test('the printable seller block escapes unicode and markup and omits contact fields', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const context = {
    document: {
      getElementById() { return { innerHTML: '', addEventListener() {} }; },
      addEventListener() {},
    },
    window: { addEventListener() {}, scrollTo() {} },
    location: { pathname: '/no-such-page' },
    history: { pushState() {}, replaceState() {} },
    fetch: () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }),
    Intl, Date, console,
  };
  vm.createContext(context);
  vm.runInContext(src + '\nglobalThis.__sellerBlock = sellerBlock;\nglobalThis.__esc = esc;\n', context);
  assert.equal(context.__sellerBlock({
    name: 'Høj <"&>\'',
    cvr: '14952705',
    address: 'Teknologiparken 4, 9440 Aabybro æøå',
    email: 'hidden@example.test',
    phone: '00000000',
  }), 'Høj &lt;&quot;&amp;&gt;&#39;<br>CVR: 14952705<br>Teknologiparken 4, 9440 Aabybro æøå');
  assert.equal(context.__sellerBlock({ name: 'AutoB2B' }), 'AutoB2B');
  assert.equal(
    context.__esc('Betaling sker efter faktura fra Høj <"&>\'. Levering aftales efter modtaget betaling.'),
    'Betaling sker efter faktura fra Høj &lt;&quot;&amp;&gt;&#39;. Levering aftales efter modtaget betaling.',
  );
  assert.equal(src.includes('hidden@example.test'), false);
});

test('the secrets file is the only seller source when SECRETS_FILE is set', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autob2b-seller-file-'));
  const file = path.join(dir, 'secrets.env');
  fs.writeFileSync(file, `BOOTSTRAP_ADMIN_EMAIL=seller-file@example.test\nBOOTSTRAP_ADMIN_PASSWORD=Seller-File-Pass-1\nSELLER_LEGAL_NAME=Højbogaard Biler\nSELLER_CVR=14952705\nSELLER_ADDRESS=Teknologiparken 4, 9440 Aabybro, Denmark\n`, { mode: 0o600 });
  const cfg = loadBootstrapConfig({
    SECRETS_FILE: file,
    SELLER_LEGAL_NAME: 'Environment Name',
    SELLER_CVR: '00000000',
    SELLER_ADDRESS: 'Environment Address',
  });
  assert.equal(cfg.SELLER_LEGAL_NAME, 'Højbogaard Biler');
  assert.equal(cfg.SELLER_CVR, '14952705');
  assert.equal(cfg.SELLER_ADDRESS, 'Teknologiparken 4, 9440 Aabybro, Denmark');
  fs.writeFileSync(file, `BOOTSTRAP_ADMIN_EMAIL=seller-file@example.test\nBOOTSTRAP_ADMIN_PASSWORD=Seller-File-Pass-1\nSELLER_EMAIL=not-selected@example.test\n`, { mode: 0o600 });
  assert.throws(() => loadBootstrapConfig({ SECRETS_FILE: file }), /SELLER_EMAIL/);
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  assert.doesNotMatch(appSrc, /seller:\s*\{\s*name:\s*'AutoB2B'/);
  assert.equal(appSrc.includes('14952705'), false);
  assert.equal(appSrc.includes('Højbogaard'), false);
});
