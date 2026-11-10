'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('dealer search matches Danish letters and the activity filters stay read-only', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const dealers = src.slice(src.indexOf('function foldDa'), src.indexOf('function cartIcon'));
  assert.match(dealers, /Ingen forhandlere matcher/);
  assert.match(dealers, /Aldrig logget ind/);
  assert.match(dealers, /Aktiv seneste 7 dage/);
  assert.match(dealers, /Ikke aktiv i 30\+ dage/);
  assert.equal(dealers.includes("api('POST'") && dealers.includes('filterDealers'), true);
  const context = {
    document: { getElementById() { return { innerHTML: '', addEventListener() {} }; }, addEventListener() {}, querySelector() { return null; } },
    window: { addEventListener() {}, scrollTo() {} },
    location: { pathname: '/no-such-page' },
    history: { pushState() {}, replaceState() {} },
    fetch() { return Promise.resolve({ ok: false, status: 500, json: async () => ({}) }); },
    Intl, Date, console,
  };
  vm.createContext(context);
  vm.runInContext(src.replace(/\nrender\(\);\s*$/, '\n') + '\nglobalThis.__filter = filterDealers;\n', context);
  const now = Date.parse('2026-11-10T20:00:00.000Z');
  const rows = [
    { id: 1, name: 'Ægir', company_name: 'Århus Biler', cvr: '11111111', email: 'a@example.test', phone: '12 34 56 78', city: 'Århus', status: 'approved', last_seen_at: '2026-11-09T20:00:00.000Z' },
    { id: 2, name: 'Bo', company_name: 'København Auto', cvr: '22222222', email: 'bo@example.test', phone: null, city: 'København', status: 'pending', last_seen_at: null },
    { id: 3, name: 'Cille', company_name: 'Stille A/S', cvr: '33333333', email: 'c@example.test', phone: '99 88 77 66', city: 'Odense', status: 'rejected', last_seen_at: '2026-01-01T00:00:00.000Z' },
  ];
  assert.deepEqual(context.__filter(rows, { q: 'århus', nowMs: now }).map((d) => d.id), [1]);
  assert.deepEqual(context.__filter(rows, { q: 'Ægir', nowMs: now }).map((d) => d.id), [1]);
  assert.deepEqual(context.__filter(rows, { q: 'københavn', nowMs: now }).map((d) => d.id), [2]);
  assert.deepEqual(context.__filter(rows, { q: '99 88', nowMs: now }).map((d) => d.id), [3]);
  assert.deepEqual(context.__filter(rows, { status: 'pending', nowMs: now }).map((d) => d.id), [2]);
  assert.deepEqual(context.__filter(rows, { seen: 'never', nowMs: now }).map((d) => d.id), [2]);
  assert.deepEqual(context.__filter(rows, { seen: '7d', nowMs: now }).map((d) => d.id), [1]);
  assert.deepEqual(context.__filter(rows, { seen: '30d', nowMs: now }).map((d) => d.id), [3]);
  assert.deepEqual(context.__filter(rows, { q: 'findes-ikke', nowMs: now }), []);
});
