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
