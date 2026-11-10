'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('header brand links home and names Højbogård B2B', () => {
  const root = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /<title>Lukket B2B Platform for Forhandlere<\/title>/);
  assert.equal(html.includes('Højbogård'), false);
  assert.equal(html.includes('AutoB2B'), false);
  assert.deepEqual(src.match(/Højbogård/g), ['Højbogård']);
  const footer = { textContent: '' };
  let title = '';
  const context = {
    document: {
      get title() { return title; },
      set title(value) { title = value; },
      querySelector(sel) { return sel === 'footer.footer' ? footer : null; },
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
  vm.runInContext(src + '\nglobalThis.__brand = brandLink;\nglobalThis.__setUser = (u) => { S.user = u; };\n', context);
  assert.equal(title, 'Højbogård B2B – Lukket B2B Platform for Forhandlere');
  assert.equal(footer.textContent, '© Højboogård B2B – Business to business for bilforhandlere');
  assert.equal(src.includes('Højboogård'), true);
  const loggedOut = context.__brand();
  assert.equal(loggedOut.includes('Højboogård'), false);
  assert.match(loggedOut, /<a data-link class="brandlink" href="\/">/);
  assert.match(loggedOut, /aria-label="Højbogård B2B"/);
  assert.match(loggedOut, />øjbogård B2B</);
  assert.match(loggedOut, /id="hbg-badge"/);
  assert.match(loggedOut, /id="hbg-word"/);
  assert.match(loggedOut, />H</);
  assert.equal(loggedOut.includes('Højbygård'), false);
  assert.equal(loggedOut.includes('Højbogaard'), false);
  assert.equal(loggedOut.includes('AutoB2B'), false);
  context.__setUser({ role: 'admin' });
  assert.match(context.__brand(), /href="\/dashboard"/);
  context.__setUser({ role: 'dealer', status: 'approved' });
  assert.match(context.__brand(), /href="\/shop"/);
  context.__setUser({ role: 'dealer', status: 'pending' });
  assert.match(context.__brand(), /href="\/shop"/);
  for (const piece of ['function landing', 'function authPage', 'function adminShell', 'function shopShell', 'function holdPage']) {
    assert.match(src.slice(src.indexOf(piece), src.indexOf(piece) + 700), /brandLink\(\)/);
  }
});
