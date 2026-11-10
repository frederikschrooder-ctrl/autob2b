'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('the dealer header no longer links to Adgangskode and Profil owns the password form', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const shop = src.slice(src.indexOf('function shopShell'), src.indexOf('function holdPage'));
  assert.equal(shop.includes('/account/password'), false);
  assert.equal(shop.includes('>Adgangskode<'), false);
  const admin = src.slice(src.indexOf('function adminShell'), src.indexOf('async function dashboard'));
  assert.match(admin, /\/account\/password', 'Adgangskode'/);
  const profile = src.slice(src.indexOf('async function profilePage'), src.indexOf('// ---------- router'));
  assert.match(profile, /id="skift-adgangskode">Skift adgangskode</);
  assert.match(profile, /name="current_password"/);
  assert.match(profile, /name="new_password"/);
  assert.match(profile, /Mindst \$\{minPw\} tegn/);
  assert.match(profile, /minlength="\$\{minPw\}"/);
  assert.match(profile, /Gem ny adgangskode/);
  assert.match(profile, /\/api\/auth\/password/);
  assert.match(profile, /Adgangskoden er ændret/);
  assert.match(src, /path === '\/adgangskode' \|\| path === '\/account\/adgangskode'/);
  assert.match(src, /S\.user\.role === 'dealer' \? '\/account\/profile#skift-adgangskode' : '\/account\/password'/);
  assert.match(src, /path === '\/account\/password'\) return S\.user\.role === 'dealer' \? go\('\/account\/profile#skift-adgangskode', true\) : passwordPage\(\)/);
});

test('a dealer password address opens the profile section and an admin keeps the password page', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const location = { pathname: '/account/password', hash: '' };
  const app = { innerHTML: '' };
  const context = {
    document: {
      title: '',
      querySelector() { return { addEventListener() {}, innerHTML: '' }; },
      getElementById(id) { return id === 'app' ? app : { innerHTML: '', addEventListener() {}, scrollIntoView() {} }; },
      addEventListener() {},
    },
    window: { addEventListener() {}, scrollTo() {} },
    location,
    history: {
      pushState(_s, _t, url) { apply(url); },
      replaceState(_s, _t, url) { apply(url); },
    },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: async () => ({ cart: { count: 0 } }) }),
    Intl, Date, console,
  };
  function apply(url) {
    const parsed = new URL(url, 'http://local');
    location.pathname = parsed.pathname;
    location.hash = parsed.hash;
  }
  vm.createContext(context);
  const body = src.replace(/\nrender\(\);\s*$/, '\n');
  vm.runInContext(body + '\nglobalThis.__setUser = (u) => { S.user = u; S.loaded = true; };\nglobalThis.__render = () => render();\n', context);
  const dealer = { role: 'dealer', status: 'approved', name: 'Dealer', company_name: 'Køber', email: 'd@example.test', phone: '12 34 56 78', password_min_length: 4 };
  context.__setUser(dealer);
  await context.__render();
  assert.equal(location.pathname, '/account/profile');
  assert.equal(location.hash, '#skift-adgangskode');
  assert.match(app.innerHTML, /id="skift-adgangskode">Skift adgangskode/);
  assert.match(app.innerHTML, /name="current_password"/);
  assert.match(app.innerHTML, /name="new_password"/);
  assert.equal(app.innerHTML.includes('>Adgangskode<'), false);
  location.pathname = '/adgangskode';
  location.hash = '';
  await context.__render();
  assert.equal(location.pathname, '/account/profile');
  assert.equal(location.hash, '#skift-adgangskode');
  context.__setUser({ role: 'admin', status: 'approved', name: 'Admin', email: 'a@example.test', password_min_length: 4 });
  location.pathname = '/adgangskode';
  location.hash = '';
  await context.__render();
  assert.equal(location.pathname, '/account/password');
  assert.equal(location.hash, '');
  assert.match(app.innerHTML, /href="\/account\/password"[^>]*>Adgangskode</);
});
