'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('dashboard recent orders include Rediger and Slet', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(src, /ordersTable\(s\.recent_orders, 'recent'\)/);
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
  vm.runInContext(src + '\nglobalThis.__ordersTable = ordersTable;\n', context);
  const html = context.__ordersTable([{
    id: 7,
    item_label: 'VW Golf',
    dealer: { company_name: 'Ui Forhandler' },
    kind: 'buy',
    price: 4500,
    status: 'confirmed',
    created_at: '2026-11-09T00:00:00.000Z',
  }], 'recent');
  assert.match(html, /class="recent-order"/);
  assert.match(html, /href="\/dashboard\/orders\/7\/edit"/);
  assert.match(html, />Rediger</);
  assert.match(html, /data-archive="7"/);
  assert.match(html, />Slet</);
  assert.equal(html.includes('<table'), false);
});

test('admin orders table shows Mobilnummer after Forhandler and hides a missing number', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const shop = src.slice(src.indexOf('function shopOrders'), src.indexOf('function agreementPage'));
  assert.equal(shop.includes('Mobilnummer'), false);
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
  vm.runInContext(src + '\nglobalThis.__ordersTable = ordersTable;\n', context);
  const row = {
    id: 3,
    item_label: 'VW Golf',
    kind: 'buy',
    price: 189000,
    status: 'confirmed',
    created_at: '2026-11-09T00:00:00.000Z',
    has_agreement: false,
  };
  const shown = context.__ordersTable([{ ...row, phone: '99 88 77 66', dealer: { company_name: 'Aabybro', phone: '11 22 33 44' } }], 'full');
  assert.match(shown, /<th>Forhandler<\/th><th>Mobilnummer<\/th><th>Vare<\/th>/);
  assert.match(shown, /href="tel:99887766"/);
  assert.equal(shown.includes('11 22 33 44'), false);
  const fallback = context.__ordersTable([{ ...row, dealer: { company_name: 'Aabybro', phone: '11 22 33 44' } }], 'full');
  assert.match(fallback, /href="tel:11223344"/);
  const missing = context.__ordersTable([{ ...row, phone: null, dealer: { company_name: 'Aabybro', phone: null } }], 'full');
  assert.match(missing, /<span class="muted">–<\/span>/);
  assert.equal(missing.includes('type="tel"'), false);
  assert.equal(missing.includes('<input'), false);
});
