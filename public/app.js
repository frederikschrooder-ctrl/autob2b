'use strict';
const BRAND = 'Højboogård';
const BRAND_MARK = BRAND + ' B2B';
document.title = BRAND_MARK + ' – Lukket B2B Platform for Forhandlere';
const $footer = typeof document.querySelector === 'function' ? document.querySelector('footer.footer') : null;
if ($footer) $footer.textContent = '© ' + BRAND_MARK + ' – Business to business for bilforhandlere';
const $app = document.getElementById('app');
const S = { user: null };

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function sellerBlock(seller) {
  const s = seller && typeof seller === 'object' ? seller : {};
  const lines = [];
  if (s.name) lines.push(esc(s.name));
  if (s.cvr) lines.push('CVR: ' + esc(s.cvr));
  if (s.address) lines.push(esc(s.address));
  return lines.join('<br>');
}
const dkk = (n) => new Intl.NumberFormat('da-DK').format(n ?? 0) + ' DKK';
const num = (n) => new Intl.NumberFormat('da-DK').format(n ?? 0);
const dt = (s) => (s ? new Date(s).toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', dateStyle: 'short', timeStyle: 'short' }) : '—');
function sidstAktiv(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'Aldrig';
  const parts = new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('day')}. ${get('month')} ${get('year')} kl. ${get('hour')}:${get('minute')}`;
}
const L = {
  vstatus: { available: 'Tilgængelig', reserved: 'Reserveret', sold: 'Solgt', unavailable: 'Ikke tilgængelig' },
  ostatus: { pending: 'Afventende', confirmed: 'Bekræftet', completed: 'Gennemført', cancelled: 'Annulleret', expired: 'Udløbet' },
  dstatus: { pending: 'Afventende', approved: 'Aktiv', rejected: 'Afvist' },
  fuel: { el: 'El', hybrid: 'Hybrid', benzin: 'Benzin', diesel: 'Diesel' },
  gear: { automatic: 'Automatisk', manual: 'Manuel' },
  kind: { reserve: 'Reservation', buy: 'Køb' },
};
const pill = (map, k) => `<span class="pill ${esc(k)}">${esc(map[k] || k)}</span>`;
function telLink(phone) {
  if (!phone) return '';
  return `<a href="tel:${esc(String(phone).replace(/[^\d+]/g, ''))}">${esc(phone)}</a>`;
}

async function api(method, url, body) {
  const opts = { method, headers: { 'x-requested-with': 'autob2b' }, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(j.error || 'Der opstod en fejl'); e.status = r.status; throw e; }
  return j;
}
const go = (path, replace) => { history[replace ? 'replaceState' : 'pushState']({}, '', path); render(); };
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey && e.button === 0) { e.preventDefault(); go(a.getAttribute('href')); }
  const open = e.target.closest('[data-resale]');
  const dialog = document.getElementById('resale-dialog');
  if (open && dialog) {
    dialog.dataset.order = open.dataset.resale;
    dialog.dataset.vehicle = open.dataset.vehicle;
    const copy = document.getElementById('resale-copy');
    if (copy) copy.textContent = open.getAttribute('data-text') || '';
    const reason = document.getElementById('resale-reason');
    if (reason) reason.value = '';
    dialog.hidden = false;
    return;
  }
  if (e.target.id === 'resale-cancel' || e.target.id === 'resale-dialog') {
    if (dialog) { dialog.hidden = true; delete dialog.dataset.order; delete dialog.dataset.vehicle; }
  }
});
document.addEventListener('submit', async (e) => {
  if (!e.target || e.target.id !== 'resale-form') return;
  e.preventDefault();
  const dialog = document.getElementById('resale-dialog');
  if (!dialog || !dialog.dataset.order) return;
  const reason = document.getElementById('resale-reason');
  try {
    await api('POST', '/api/admin/orders/' + dialog.dataset.order + '/resell', { confirm: true, vehicle_id: Number(dialog.dataset.vehicle), reason: reason ? reason.value : '' });
    dialog.hidden = true;
    const path = location.pathname;
    if (path === '/dashboard/orders') { const st = document.getElementById('st'); if (st) st.dispatchEvent(new Event('change')); }
    else go(path, true);
  } catch (err) {
    const msg = document.getElementById('msg');
    if (msg) showErr(msg, err);
  }
});
window.addEventListener('popstate', render);
const link = (href, text, cls = '') => `<a data-link href="${esc(href)}" class="${cls}">${text}</a>`;
function isStaff(u) {
  if (!u) return false;
  if (u.staff === true) return true;
  if (u.staff === false) return false;
  return u.role === 'admin';
}
function brandHome() {
  if (!S.user) return '/';
  return isStaff(S.user) ? '/dashboard' : '/shop';
}
function brandLink() {
  const label = esc(BRAND_MARK);
  const word = esc(BRAND_MARK);
  return `<a data-link class="brandlink" href="${esc(brandHome())}"><svg class="brandmark" viewBox="0 0 196 52" role="img" aria-label="${label}" text-rendering="geometricPrecision" shape-rendering="geometricPrecision"><title>${label}</title><defs><linearGradient id="hbg-word" x1="6" y1="0" x2="214" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fafffe"/><stop offset="0.68" stop-color="#fafffe"/><stop offset="1" stop-color="#e7f6e3"/></linearGradient></defs><text x="6" y="34" fill="url(#hbg-word)" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700">${word}</text></svg></a>`;
}
const btnLink = (href, text, cls = '') => `<a data-link href="${esc(href)}" class="btn ${cls}">${text}</a>`;
const showErr = (el, e) => { el.innerHTML = `<div class="err">${esc(e.message || e)}</div>`; };
async function logout() { try { await api('POST', '/api/auth/logout', {}); } catch {} S.user = null; go('/login'); }

// ---------- landing ----------
function landing() {
  $app.innerHTML = `
  <header class="banner hero-banner">
  <div class="topbar">${brandLink()}<div>${S.user ? btnLink(isStaff(S.user) ? '/dashboard' : '/shop', 'Til platformen') : btnLink('/login', 'Log ind', 'outline')}</div></div>
  <section class="hero">
    <div class="card hero-card">
    <div class="badge">Lukket B2B Platform — Kun for Forhandlere</div>
    <h1>Premium Importerede Biler Fra Tyskland til Danmark</h1>
    <p>Køb kvalitetsbiler direkte til engrospriser – enkeltvis eller i partier. Adgang kræver en godkendt forhandlerkonto.</p>
    <div class="row">${btnLink('/register', 'Ansøg om Forhandlerkonto', 'big apply')}${btnLink('/login', 'Log Ind', 'big outline')}</div>
    </div>
  </section>
  </header>
  <section class="section"><h2>Hvad Vi Tilbyder</h2>
    <div class="cards">
      <div class="card"><h3>Enkeltbiler</h3><p>Gennemse vores udvalg af importerede biler fra Tyskland med fuld specifikation, billeder og tilstandsrapport. Alle priser er engrospriser ekskl. moms.</p></div>
      <div class="card"><h3>Partier</h3><p>Køb biler i partier på 10, 20 eller 30 stk. til en samlet favorabel pris. Når et nyt parti oprettes, bliver alle godkendte forhandlere underrettet.</p></div>
    </div></section>
  <section class="section alt"><h2>Sådan Fungerer Det</h2>
    <div class="steps">
      <div class="step card"><div class="num">1</div><h3>Registrer</h3><p>Opret en forhandlerkonto med dit firmanavn og CVR-nummer.</p></div>
      <div class="step card"><div class="num">2</div><h3>Bliv Godkendt</h3><p>Vi verificerer din virksomhed, og du får adgang, når kontoen er godkendt.</p></div>
      <div class="step card"><div class="num">3</div><h3>Gennemse &amp; Køb</h3><p>Reserver en bil i 24 timer, eller køb med det samme – vi genererer automatisk en købsaftale.</p></div>
      <div class="step card"><div class="num">4</div><h3>Modtag Bilerne</h3><p>Vi sørger for levering af bilerne til dig i Danmark.</p></div>
    </div></section>
  <section class="cta"><h2>Klar til at komme i gang?</h2>${btnLink('/register', 'Ansøg om Forhandlerkonto', 'big')}</section>`;
}

// ---------- auth ----------
function authPage(kind) {
  const isLogin = kind === 'login';
  $app.innerHTML = `<div class="authpage"><header class="banner hero-banner auth-banner">${brandLink()}</header><div class="authwrap"><form class="authbox" id="f" novalidate>
    <h1>${isLogin ? 'Log ind' : 'Ansøg om Forhandlerkonto'}</h1>
    <p class="muted">${isLogin ? 'Administratorer og forhandlere bruger samme login.' : 'Udfyld oplysningerne – vi godkender din ansøgning manuelt.'}</p>
    <div id="msg"></div>
    ${isLogin ? '' : `<label>Firmanavn</label><input name="company_name" required autocomplete="organization">
      <div class="grid2"><div><label>CVR-nummer</label><input name="cvr" required inputmode="numeric" maxlength="10"></div><div><label>By</label><input name="city" required autocomplete="address-level2"></div></div>
      <label>Mobilnummer</label><input type="tel" name="phone" required autocomplete="tel" inputmode="tel" maxlength="32" placeholder="+45 12 34 56 78">`}
    <label>E-mail</label><input type="email" name="email" required autocomplete="email">
    <label>Adgangskode</label><input type="password" name="password" required autocomplete="${isLogin ? 'current-password' : 'new-password'}" ${isLogin ? '' : 'minlength="4"'}>
    ${isLogin ? '' : '<div class="muted" style="font-size:.8rem">Mindst 4 tegn.</div>'}
    <button class="btn" type="submit">${isLogin ? 'Log Ind' : 'Send Ansøgning'}</button>
    <div class="links">${isLogin ? link('/register', 'Ansøg om forhandlerkonto', 'apply') : link('/login', 'Har du allerede en konto? Log ind')}${link('/', '← Tilbage')}</div>
  </form></div></div>`;
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const msg = document.getElementById('msg'); const btn = f.querySelector('button');
    const d = Object.fromEntries(new FormData(f)); btn.disabled = true;
    try {
      if (!isLogin && String(d.password || '').length < 4) throw new Error('Adgangskoden skal være mindst 4 tegn');
      if (!isLogin && String(d.phone || '').replace(/\D/g, '').length < 8) throw new Error('Mobilnummer skal være 8-15 cifre');
      if (isLogin) {
        const r = await api('POST', '/api/auth/login', d); S.user = r.user;
        go(isStaff(r.user) ? '/dashboard' : '/shop');
      } else {
        const r = await api('POST', '/api/auth/register', d);
        f.innerHTML = `<h1>Tak for din ansøgning</h1><div class="ok">${esc(r.message)}</div><p class="muted">Du kan logge ind, men får først adgang til platformen, når din konto er godkendt.</p>${btnLink('/login', 'Til login')}`;
      }
    } catch (err) { showErr(msg, err); btn.disabled = false; }
  });
}

// ---------- admin layout ----------
function adminShell(active, inner) {
  const nav = [['/dashboard', 'Oversigt'], ['/dashboard/vehicles', 'Biler'], ['/dashboard/packages', 'Partier'], ['/dashboard/orders', 'Ordrer'], ['/dashboard/dealers', 'Forhandlere'], ['/account/password', 'Adgangskode']];
  $app.innerHTML = `<div class="layout"><header class="adminbar banner"><div class="sidehead">${brandLink()}<button type="button" class="navtoggle" id="navtoggle" aria-expanded="false" aria-controls="sidenav">Menu</button></div></header><div class="layout-body"><aside class="side" id="side">
    <nav id="sidenav" aria-label="Administration">${nav.map(([h, t]) => `<a data-link href="${esc(h)}" class="${h === active ? 'active' : ''}" ${h === active ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    <div class="user"><div class="n">${esc(S.user.name)}</div><div class="e">${esc(S.user.email)}</div><button type="button" id="lo">Log Ud</button></div></aside>
    <main class="main">${inner}</main></div></div>`;
  document.getElementById('lo').onclick = logout;
  const toggle = document.getElementById('navtoggle');
  toggle.onclick = () => {
    const open = document.getElementById('side').classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = open ? 'Luk menu' : 'Menu';
  };
}
const cell = (label, html, cls = '') => `<td${cls ? ` class="${cls}"` : ''}><span class="celllabel">${label}</span>${html}</td>`;
const sel = (el) => document.querySelector(el);
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function dashboard() {
  adminShell('/dashboard', '<h1>Indlæser…</h1>');
  const s = await api('GET', '/api/admin/stats');
  const card = (l, v) => `<div class="stat"><div class="l">${l}</div><div class="v">${v}</div></div>`;
  adminShell('/dashboard', `<h1>Velkommen tilbage, ${esc(S.user.name)}</h1><p class="muted">Her er et overblik over platformen.</p>
    <div class="stats">${card('Biler i alt', num(s.vehicles_total))}${card('Tilgængelige', num(s.vehicles_available))}${card('Aktive Partier', num(s.active_packages))}${card('Ordrer i alt', num(s.orders_total))}${card('Omsætning', dkk(s.revenue))}${card('Afventende Forhandlere', num(s.pending_dealers))}</div>
    <h2>Seneste Ordrer</h2><div id="msg"></div>${ordersTable(s.recent_orders, 'recent')}`);
  document.querySelector('.main').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-archive]');
    if (!b) return;
    if (!confirmArchive(b.dataset.archive)) return;
    try { await api('POST', '/api/admin/orders/' + b.dataset.archive + '/archive', {}); dashboard(); }
    catch (err) { showErr(sel('#msg'), err); }
  });
}

// ---------- admin: vehicles ----------
async function vehiclesPage() {
  adminShell('/dashboard/vehicles', `<div class="pagehead"><div><h1>Biler</h1><div class="muted" id="cnt">&nbsp;</div></div>${btnLink('/dashboard/vehicles/new', '+ Tilføj Bil')}</div>
    <div class="filters"><input id="q" placeholder="Søg på VIN, mærke eller model…">
    <select id="st"><option value="">Alle statusser</option>${Object.entries({ available: 'Tilgængelig', reserved: 'Reserveret', sold: 'Solgt' }).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}<option value="archived">Arkiv</option></select>
    <select id="fu"><option value="">Alle brændstoftyper</option>${Object.entries(L.fuel).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div id="msg"></div><div id="tbl"></div>`);
  const load = async () => {
    if (!sel('#q')) return;
    const archiveView = sel('#st').value === 'archived';
    const p = new URLSearchParams(); if (sel('#q').value) p.set('q', sel('#q').value); if (archiveView) p.set('archived', '1'); else if (sel('#st').value) p.set('status', sel('#st').value); if (sel('#fu').value) p.set('fuel', sel('#fu').value);
    try {
      const r = await api('GET', '/api/admin/vehicles?' + p);
      sel('#cnt').textContent = `${r.count} ${r.count === 1 ? 'bil' : 'biler'}`;
      const actions = (v) => (archiveView
        ? `<span class="archive-actions"><button type="button" class="btn small" data-restore-vehicle="${v.id}" aria-label="Gendan ${esc(v.make + ' ' + v.model)}">Gendan</button><button type="button" class="btn small danger" data-purge-vehicle="${v.id}" aria-label="Slet permanent ${esc(v.make + ' ' + v.model)}">Slet permanent</button></span>`
        : `${btnLink('/dashboard/vehicles/' + v.id + '/edit', 'Rediger', 'small outline')}<button type="button" class="btn small danger" data-del="${v.id}" data-name="${esc(v.make + ' ' + v.model + ' (' + v.vin + ')')}" aria-label="Slet ${esc(v.make + ' ' + v.model)}">Slet</button>`);
      sel('#tbl').innerHTML = r.vehicles.length ? `<div class="tablewrap"><table><thead><tr><th></th><th>VIN</th><th>Mærke / Model</th><th>Variant</th><th>Km</th><th>Brændstof</th><th>Engrospris</th><th>Status</th><th>Handlinger</th></tr></thead><tbody>
      ${r.vehicles.map((v) => `<tr>${cell('Billede', v.images[0] ? `<img class="thumb" src="${esc(v.images[0])}" alt="">` : '<div class="thumb"></div>')}${cell('VIN', esc(v.vin))}${cell('Mærke / Model', `<b>${esc(v.make)}</b> ${esc(v.model)}`)}${cell('Variant', esc(v.variant || '—'))}${cell('Km', v.mileage != null ? num(v.mileage) : '—')}${cell('Brændstof', esc(L.fuel[v.fuel] || '—'))}${cell('Engrospris', dkk(v.price))}${cell('Status', pill(L.vstatus, v.status))}
      ${cell('Handlinger', actions(v), 'act')}</tr>`).join('')}</tbody></table></div>` : '<div class="tablewrap"><div class="empty">Ingen biler fundet.</div></div>';
    } catch (e) { showErr(sel('#msg'), e); }
  };
  sel('#q').addEventListener('input', debounce(load)); sel('#st').onchange = load; sel('#fu').onchange = load;
  sel('#tbl').addEventListener('click', async (e) => {
    const restore = e.target.closest('[data-restore-vehicle]');
    if (restore) {
      if (!confirm('Gendan bilen? Lagerstatus og købsaftaler ændres ikke.')) return;
      try { await api('POST', '/api/admin/vehicles/' + restore.dataset.restoreVehicle + '/restore', {}); sel('#msg').innerHTML = ''; load(); }
      catch (err) { showErr(sel('#msg'), err); }
      return;
    }
    const purge = e.target.closest('[data-purge-vehicle]');
    if (purge) {
      if (!confirmPurge()) return;
      try {
        const r = await api('DELETE', '/api/admin/archived/vehicles/' + purge.dataset.purgeVehicle);
        sel('#msg').innerHTML = r.message ? `<div class="notice">${esc(r.message)}</div>` : '<div class="ok">Slettet.</div>';
        load();
      } catch (err) { showErr(sel('#msg'), err); }
      return;
    }
    const b = e.target.closest('[data-del]'); if (!b) return;
    if (!confirm(`Er du sikker på, at du vil slette ${b.dataset.name}? Det kan ikke fortrydes.`)) return;
    try { await api('DELETE', '/api/admin/vehicles/' + b.dataset.del); sel('#msg').innerHTML = ''; load(); } catch (err) { showErr(sel('#msg'), err); }
  });
  load();
}

async function vehicleForm(id) {
  let v = { images: [] };
  adminShell('/dashboard/vehicles', '<h1>Indlæser…</h1>');
  if (id) { try { v = (await api('GET', '/api/admin/vehicles/' + id)).vehicle; } catch (e) { return adminShell('/dashboard/vehicles', `<div class="err">${esc(e.message)}</div>`); } }
  const images = [...v.images];
  const opt = (map, cur, ph) => `<option value="">${ph}</option>` + Object.entries(map).map(([k, t]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${t}</option>`).join('');
  adminShell('/dashboard/vehicles', `<div class="pagehead"><h1>${id ? 'Rediger Bil' : 'Tilføj Bil'}</h1></div><div id="msg"></div>
  <form id="f" novalidate>
   <div class="formcard"><h2>Køretøjsidentifikation</h2><div class="grid2">
     <div><label>VIN *</label><input name="vin" required maxlength="17" value="${esc(v.vin || '')}" style="text-transform:uppercase"></div>
     <div><label>Mærke *</label><input name="make" required value="${esc(v.make || '')}"></div>
     <div><label>Model *</label><input name="model" required value="${esc(v.model || '')}"></div>
     <div><label>Variant</label><input name="variant" value="${esc(v.variant || '')}"></div></div></div>
   <div class="formcard"><h2>Specifikationer</h2><div class="grid2">
     <div><label>Første Registreringsdato</label><input type="date" name="first_registration" value="${esc(v.first_registration || '')}"></div>
     <div><label>Kilometer</label><input type="number" min="0" name="mileage" value="${v.mileage ?? ''}"></div>
     <div><label>Brændstoftype</label><select name="fuel">${opt(L.fuel, v.fuel, 'Vælg…')}</select></div>
     <div><label>Gearkasse</label><select name="transmission">${opt(L.gear, v.transmission, 'Vælg…')}</select></div>
     <div><label>Farve</label><input name="color" value="${esc(v.color || '')}"></div>
     <div><label>Engrospris (DKK, ekskl. moms) *</label><input type="number" min="1" name="price" required value="${v.price ?? ''}"></div></div></div>
   <div class="formcard"><h2>Billeder</h2><p class="muted" style="margin-top:0">Billede 1 er hovedbilledet. Nye billeder lægges sidst. Rækkefølgen gemmes først, når du trykker Gem bil.</p><input type="file" id="files" multiple accept=".jpg,.jpeg,.png,.heic,.webp,image/jpeg,image/png,image/webp,image/heic"><div class="previews" id="pv"></div></div>
   <div class="formcard"><h2>Dokumenter</h2><label>Tilstandsrapport (URL)</label><input type="url" name="condition_report_url" placeholder="https://…" value="${esc(v.condition_report_url || '')}"></div>
   <button class="btn" type="submit">Gem Bil</button> ${btnLink('/dashboard/vehicles', 'Annuller', 'outline')}
  </form>`);
  const drawPv = () => {
    sel('#pv').innerHTML = images.length ? images.map((u, i) => `<div class="pv">
      <div class="pv-pos">${i === 0 ? '<span class="pill">Hovedbillede</span>' : ''}<span class="muted">#${i + 1}</span></div>
      ${u.endsWith('.heic') ? '<div class="heic">HEIC</div>' : `<img src="${esc(u)}" alt="">`}
      <div class="pv-actions">
        <button type="button" class="btn small outline" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Flyt billede ${i + 1} op">Op</button>
        <button type="button" class="btn small outline" data-down="${i}" ${i === images.length - 1 ? 'disabled' : ''} aria-label="Flyt billede ${i + 1} ned">Ned</button>
        <button type="button" class="btn small danger" data-rm="${i}" aria-label="Fjern billede ${i + 1}">Fjern</button>
      </div>
    </div>`).join('') : '<p class="muted">Ingen billeder endnu.</p>';
  };
  drawPv();
  sel('#pv').addEventListener('click', (e) => {
    const up = e.target.closest('[data-up]');
    const down = e.target.closest('[data-down]');
    const rm = e.target.closest('[data-rm]');
    if (up && !up.disabled) {
      const i = +up.dataset.up;
      if (i > 0) { const moved = images.splice(i, 1)[0]; images.splice(i - 1, 0, moved); drawPv(); }
    } else if (down && !down.disabled) {
      const i = +down.dataset.down;
      if (i < images.length - 1) { const moved = images.splice(i, 1)[0]; images.splice(i + 1, 0, moved); drawPv(); }
    } else if (rm) { images.splice(+rm.dataset.rm, 1); drawPv(); }
  });
  sel('#files').addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      try {
        const r = await fetch('/api/admin/uploads', { method: 'POST', headers: { 'x-requested-with': 'autob2b', 'content-type': 'application/octet-stream' }, body: file, credentials: 'same-origin' });
        const j = await r.json(); if (!r.ok) throw new Error(`${file.name}: ${j.error}`);
        images.push(j.url); drawPv();
      } catch (err) { showErr(sel('#msg'), err); }
    }
    e.target.value = '';
  });
  sel('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target)); d.images = images;
    ['mileage', 'price'].forEach((k) => { if (d[k] === '') delete d[k]; });
    try { await api(id ? 'PUT' : 'POST', '/api/admin/vehicles' + (id ? '/' + id : ''), d); go('/dashboard/vehicles'); } catch (err) { showErr(sel('#msg'), err); window.scrollTo(0, 0); }
  });
}

// ---------- admin: packages ----------
async function packagesPage() {
  adminShell('/dashboard/packages', '<h1>Indlæser…</h1>');
  const [pk, vs, archivedPk] = await Promise.all([api('GET', '/api/admin/packages'), api('GET', '/api/admin/vehicles'), api('GET', '/api/admin/packages?archived=1')]);
  const free = vs.vehicles.filter((v) => v.status === 'available');
  const byId = Object.fromEntries(free.map((v) => [v.id, v]));
  const selected = new Set();
  let priceTouched = false;

  const rowHtml = (v) => {
    const img = v.images && v.images[0] && !String(v.images[0]).endsWith('.heic')
      ? `<img class="thumb" src="${esc(v.images[0])}" alt="">`
      : '<div class="thumb pick-ph">🚗</div>';
    const checked = selected.has(v.id) ? 'checked' : '';
    const on = selected.has(v.id) ? ' on' : '';
    return `<label class="pick-row${on}" data-id="${v.id}">
      <input type="checkbox" name="vid" value="${v.id}" ${checked}>
      ${img}
      <div class="pick-meta">
        <div class="pick-title"><b>${esc(v.make)} ${esc(v.model)}</b>${v.variant ? ` <span class="muted">${esc(v.variant)}</span>` : ''}</div>
        <div class="pick-sub muted">${esc(v.vin)} · ${v.mileage != null ? num(v.mileage) + ' km' : '—'} · ${esc(L.fuel[v.fuel] || '—')}</div>
      </div>
      <div class="pick-price">${dkk(v.price)}</div>
    </label>`;
  };
  const archiveHtml = archivedPk.packages.length
    ? '<div class="cards">' + archivedPk.packages.map((p) => {
      const cars = p.vehicle_count === 1 ? 'bil' : 'biler';
      return `<div class="card"><div style="display:flex;justify-content:space-between;gap:.5rem"><h3>${esc(p.name)}</h3>${pill(L.vstatus, p.effective_status)}</div><div class="price">${dkk(p.total_price)}</div><p class="muted">${esc(p.description || '')}</p><p><b>${p.vehicle_count}</b> ${cars}</p><div class="archive-actions"><button type="button" class="btn small" data-restore-package="${p.id}" aria-label="Gendan ${esc(p.name)}">Gendan</button><button type="button" class="btn small danger" data-purge-package="${p.id}" aria-label="Slet permanent ${esc(p.name)}">Slet permanent</button></div></div>`;
    }).join('') + '</div>'
    : '<div class="tablewrap"><div class="empty">Ingen arkiverede partier.</div></div>';

  adminShell('/dashboard/packages', `<div class="pagehead"><h1>Bilpartier</h1></div><div id="msg"></div>
  <form id="f" class="formcard" novalidate><h2>Opret Parti</h2>
    <div class="grid2"><div><label>Partinavn *</label><input name="name" required placeholder="Fx Parti marts 20 stk."></div>
    <div><label>Total Pris (DKK) *</label><input type="number" min="1" name="total_price" id="total_price" required placeholder="Udfyldes gerne automatisk"><div class="muted" style="font-size:.78rem;margin-top:.25rem">Tomt felt foreslås ud fra summen af valgte bilers katalogpris.</div></div></div>
    <label>Beskrivelse</label><textarea name="description" rows="2" placeholder="Kort beskrivelse til forhandlerne"></textarea>
    <label>Vælg biler i partiet</label>
    <div class="muted pick-hint">Tip: vælg typisk 10 / 20 / 30 biler til et parti</div>
    <div class="pick-toolbar">
      <input type="search" id="pq" placeholder="Søg mærke, model, VIN eller variant…" autocomplete="off">
      <select id="pfu"><option value="">Alle brændstoftyper</option>${Object.entries(L.fuel).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input type="number" id="pmin" min="0" placeholder="Min. pris" title="Min. pris">
      <input type="number" id="pmax" min="0" placeholder="Max. pris" title="Max. pris">
    </div>
    <div class="pick-actions">
      <button type="button" class="btn small outline" id="psel">Vælg alle synlige</button>
      <button type="button" class="btn small outline" id="pclr">Fjern valg</button>
      <div class="pick-count" id="sc">0 valgt · katalogpris ca. 0 DKK</div>
    </div>
    <div class="pick-selected" id="chips" hidden></div>
    <div class="pick" id="plist">${free.length ? '' : '<div class="muted" style="padding:.6rem">Ingen tilgængelige biler. Tilføj biler under Biler først.</div>'}</div>
    <button class="btn" style="margin-top:1rem" type="submit">Opret Parti</button>
    <div class="muted" style="font-size:.8rem;margin-top:.4rem">Alle godkendte forhandlere får en notifikation om det nye parti.</div>
  </form>
  ${pk.packages.length ? `<div class="cards">${pk.packages.map((p) => `<div class="card"><div style="display:flex;justify-content:space-between;gap:.5rem"><h3>${esc(p.name)}</h3>${pill(L.vstatus, p.effective_status)}</div>
    <div class="price">${dkk(p.total_price)}</div><p class="muted">${esc(p.description || '')}</p>
    <p><b>${p.vehicle_count}</b> ${p.vehicle_count === 1 ? 'bil' : 'biler'}${p.vehicles.length ? ':' : ''}</p><ul style="margin:0 0 1rem 1.1rem;padding:0;font-size:.88rem">${p.vehicles.map((v) => `<li>${esc(v.make)} ${esc(v.model)} <span class="muted">${esc(v.vin)}</span></li>`).join('')}</ul>
    ${p.status === 'available' ? btnLink('/dashboard/packages/' + p.id + '/edit', 'Rediger', 'small outline') : ''}<button type="button" class="btn small danger" data-del="${p.id}" data-name="${esc(p.name)}">Slet Parti</button></div>`).join('')}</div>` : '<div class="tablewrap"><div class="empty">Ingen partier endnu.</div></div>'}
  <h2>Arkiv</h2>
  <p class="muted">Slet fjerner et parti, der allerede er arkiveret. Billeder og partikoblinger slettes. En købsaftale og ordren bliver liggende.</p>
  <div id="pkgarch">${archiveHtml}</div>
`);

  const visibleIds = () => [...document.querySelectorAll('#plist .pick-row')].map((el) => +el.dataset.id);

  const syncTotal = () => {
    const inp = sel('#total_price');
    if (!inp || priceTouched) return;
    let sum = 0;
    selected.forEach((id) => { if (byId[id]) sum += Number(byId[id].price) || 0; });
    inp.value = selected.size ? String(sum) : '';
  };

  const renderChips = () => {
    const box = sel('#chips');
    if (!box) return;
    if (!selected.size) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = [...selected].map((id) => {
      const v = byId[id]; if (!v) return '';
      return `<span class="chip" data-id="${id}">${esc(v.make)} ${esc(v.model)} <button type="button" class="chip-x" aria-label="Fjern ${esc(v.make)} ${esc(v.model)}">×</button></span>`;
    }).join('');
  };

  const updateCount = () => {
    let sum = 0;
    selected.forEach((id) => { if (byId[id]) sum += Number(byId[id].price) || 0; });
    const el = sel('#sc');
    if (el) el.textContent = `${selected.size} valgt · katalogpris ca. ${num(sum)} DKK`;
    document.querySelectorAll('#plist .pick-row').forEach((row) => {
      const on = selected.has(+row.dataset.id);
      row.classList.toggle('on', on);
      const cb = row.querySelector('input');
      if (cb) cb.checked = on;
    });
    renderChips();
    syncTotal();
  };

  const applyFilter = () => {
    const list = sel('#plist');
    if (!list || !free.length) return;
    const q = (sel('#pq')?.value || '').trim().toLowerCase();
    const fu = sel('#pfu')?.value || '';
    const minP = sel('#pmin')?.value !== '' && sel('#pmin')?.value != null ? Number(sel('#pmin').value) : null;
    const maxP = sel('#pmax')?.value !== '' && sel('#pmax')?.value != null ? Number(sel('#pmax').value) : null;
    const filtered = free.filter((v) => {
      if (fu && v.fuel !== fu) return false;
      const price = Number(v.price) || 0;
      if (minP != null && !Number.isNaN(minP) && price < minP) return false;
      if (maxP != null && !Number.isNaN(maxP) && price > maxP) return false;
      if (!q) return true;
      const hay = [v.make, v.model, v.variant, v.vin].map((x) => String(x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
    list.innerHTML = filtered.length
      ? filtered.map(rowHtml).join('')
      : '<div class="muted" style="padding:.6rem">Ingen biler matcher søgning/filtre.</div>';
    updateCount();
  };

  applyFilter();

  sel('#pq')?.addEventListener('input', debounce(applyFilter, 120));
  sel('#pfu')?.addEventListener('change', applyFilter);
  sel('#pmin')?.addEventListener('input', debounce(applyFilter, 120));
  sel('#pmax')?.addEventListener('input', debounce(applyFilter, 120));
  sel('#total_price')?.addEventListener('input', () => { priceTouched = true; });

  sel('#psel')?.addEventListener('click', () => {
    visibleIds().forEach((id) => selected.add(id));
    updateCount();
  });
  sel('#pclr')?.addEventListener('click', () => {
    selected.clear();
    priceTouched = false;
    updateCount();
  });

  sel('#plist')?.addEventListener('change', (e) => {
    const cb = e.target.closest('input[name=vid]');
    if (!cb) return;
    const id = +cb.value;
    if (cb.checked) selected.add(id); else selected.delete(id);
    updateCount();
  });
  sel('#chips')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-x');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = +btn.closest('.chip').dataset.id;
    selected.delete(id);
    updateCount();
  });

  sel('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = sel('#msg');
    if (!selected.size) {
      showErr(msg, new Error('Vælg mindst én bil til partiet.'));
      window.scrollTo(0, 0);
      return;
    }
    const d = Object.fromEntries(new FormData(e.target));
    d.vehicle_ids = [...selected];
    delete d.vid;
    if (!d.total_price) {
      let sum = 0;
      selected.forEach((id) => { if (byId[id]) sum += Number(byId[id].price) || 0; });
      d.total_price = sum;
    }
    try { await api('POST', '/api/admin/packages', d); packagesPage(); } catch (err) { showErr(msg, err); window.scrollTo(0, 0); }
  });
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Slet partiet "${b.dataset.name}"?\n\nEt parti uden ordrer slettes sammen med dets biler og billeder.\nEt parti med en ordre eller købsaftale fjernes fra listen. Aftalen og ordren bliver liggende.`)) return;
    try { await api('DELETE', '/api/admin/packages/' + b.dataset.del); packagesPage(); }
    catch (err) {
      const msg = sel('#msg');
      showErr(msg, err);
      if (msg) msg.scrollIntoView({ block: 'center' });
    }
  }));
  document.querySelectorAll('[data-restore-package]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Gendan partiet? Lagerstatus og købsaftaler ændres ikke.')) return;
    const msg = sel('#msg');
    try { await api('POST', '/api/admin/packages/' + b.dataset.restorePackage + '/restore', {}); packagesPage(); }
    catch (err) { showErr(msg, err); if (msg) msg.scrollIntoView({ block: 'center' }); }
  }));
  document.querySelectorAll('[data-purge-package]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirmPurge()) return;
    const msg = sel('#msg');
    try {
      const r = await api('DELETE', '/api/admin/archived/packages/' + b.dataset.purgePackage);
      if (msg) msg.innerHTML = r.message ? `<div class="notice">${esc(r.message)}</div>` : '<div class="ok">Slettet.</div>';
      const card = b.closest('.card');
      if (card) card.remove();
      if (!document.querySelector('[data-purge-package]')) {
        const box = sel('#pkgarch');
        if (box) box.innerHTML = '<div class="tablewrap"><div class="empty">Ingen arkiverede partier.</div></div>';
      }
    } catch (err) {
      showErr(msg, err);
      if (msg) msg.scrollIntoView({ block: 'center' });
    }
  }));
}

// ---------- admin: orders ----------
function confirmPurge() {
  return confirm('Er du sikker? Dette kan ikke fortrydes');
}
function confirmArchive(id) {
  return confirm(`Arkivér ordre #${id}?\n\nOrdren fjernes fra oversigten og tællingerne. Købsaftalen og prisen i aftalen slettes ikke.\n\nEn afventende reservation frigives.\nEn bekræftet eller gennemført handel sætter ikke bilen til salg igen.\n\nDu kan gendanne ordren under Arkiv.`);
}
function resaleCars(o) {
  if (!o || o.archived_at || !['confirmed', 'completed'].includes(o.status)) return [];
  return (o.vehicles || []).filter((v) => v && v.status === 'sold' && !v.cancelled_at);
}
function resaleButtons(o) {
  const cars = resaleCars(o);
  const multi = cars.length > 1 || !!(o && (o.package_id || (o.vehicles || []).length > 1));
  return cars.map((v) => {
    const title = [v.make, v.model, v.variant].filter(Boolean).join(' ') || ('Bil #' + v.id);
    const text = multi
      ? `Sæt ${title} til salg igen?\n\nKun denne bil frigives. De andre biler forbliver solgt.\nKøbsaftalen dækker hele ordren og slettes også.\n\nTryk OK for at fortsætte.`
      : `Sæt bilen til salg igen?\n\nOrdren annulleres, og bilen bliver tilgængelig.\nForhandlerens købsaftale for denne ordre slettes.\n\nTryk OK for at fortsætte.`;
    const label = multi ? `Sæt til salg igen: ${title}` : 'Sæt til salg igen';
    return `<button type="button" class="btn outline" data-resale="${o.id}" data-vehicle="${v.id}" data-text="${esc(text)}">${esc(label)}</button>`;
  }).join('');
}
function resaleDialog() {
  return `<div id="resale-dialog" class="modal" hidden><form id="resale-form" class="dialog" role="dialog" aria-modal="true" aria-labelledby="resale-title"><h2 id="resale-title">Sæt til salg igen</h2><p id="resale-copy"></p><label for="resale-reason">Begrundelse (valgfri)</label><input id="resale-reason" name="reason" maxlength="500"><div class="modal-actions"><button type="button" class="btn outline" id="resale-cancel">Annuller</button><button type="submit" class="btn" id="resale-ok">OK</button></div></form></div>`;
}
function resaleLogTable(rows) {
  if (!rows.length) return '<div class="tablewrap"><div class="empty">Ingen registreringer endnu.</div></div>';
  return `<div class="tablewrap"><table><thead><tr><th>Tid</th><th>Admin</th><th>Ordre</th><th>Bil</th><th>Forhandler</th><th>Aftale</th><th>Begrundelse</th></tr></thead><tbody>${rows.map((r) => `<tr>${cell('Tid', esc(sidstAktiv(r.created_at)))}${cell('Admin', esc(r.admin_name || r.admin_email || '—'))}${cell('Ordre', '#' + r.order_id)}${cell('Bil', esc([r.vehicle_title, r.vehicle_reg].filter(Boolean).join(' · ') || '—'))}${cell('Forhandler', esc(r.dealer_name || '—'))}${cell('Aftale', esc(r.agreement_number || '—'))}${cell('Begrundelse', esc(r.reason || '—'))}</tr>`).join('')}</tbody></table></div>`;
}
function recentOrders(orders) {
  if (!orders.length) return '<div class="tablewrap"><div class="empty">Ingen ordrer.</div></div>';
  return `<div class="recent-orders">${orders.map((o) => `<article class="recent-order">
    <div class="recent-main"><b>#${o.id}</b> ${esc(o.item_label)}<div class="muted">${esc(o.dealer?.company_name || '—')}${o.dealer?.phone ? ` · ${telLink(o.dealer.phone)}` : ''} · ${esc(L.kind[o.kind] || o.kind)} · ${dkk(o.price)} · ${dt(o.created_at)}</div></div>
    <div>${pill(L.ostatus, o.status)}</div>
    <div class="recent-actions">${btnLink('/dashboard/orders/' + o.id + '/edit', 'Rediger', 'small outline')}<button type="button" class="btn small danger" data-archive="${o.id}" aria-label="Arkivér ordre ${o.id}">Slet</button></div>
  </article>`).join('')}</div>`;
}
function ordersTable(orders, mode) {
  const full = mode === true || mode === 'full';
  const recent = mode === 'recent';
  const archived = mode === 'archived';
  const actions = full || recent || archived;
  if (recent) return recentOrders(orders);
  if (!orders.length) return '<div class="tablewrap"><div class="empty">Ingen ordrer.</div></div>';
  const buttons = (o) => {
    const edit = btnLink('/dashboard/orders/' + o.id + '/edit', 'Rediger', 'small outline');
    if (archived) return edit + `<span class="archive-actions"><button type="button" class="btn small" data-restore="${o.id}" aria-label="Gendan ordre ${o.id}">Gendan</button><button type="button" class="btn small danger" data-purge-order="${o.id}" aria-label="Slet permanent ordre ${o.id}">Slet permanent</button></span>`;
    const status = full ? `${o.status === 'pending' ? `<button type="button" class="btn small" data-act="confirm" data-id="${o.id}">Bekræft</button>` : ''}${o.status === 'confirmed' ? `<button type="button" class="btn small" data-act="complete" data-id="${o.id}">Gennemfør</button>` : ''}${['pending', 'confirmed'].includes(o.status) ? `<button type="button" class="btn small danger" data-act="cancel" data-id="${o.id}" aria-label="Annuller ordre ${o.id}">Annuller</button>` : ''}${o.has_agreement ? btnLink('/agreement/' + o.id, 'Aftale', 'small outline') : ''}` : '';
    const resale = full ? resaleButtons(o) : '';
    return `<div class="order-row-actions"><div class="row-actions">${status}${edit}<button type="button" class="btn small danger" data-archive="${o.id}" aria-label="Arkivér ordre ${o.id}">Slet</button></div>${resale ? `<div class="resale-actions">${resale}</div>` : ''}</div>`;
  };
  const mobile = (o) => {
    const stored = o.phone != null && String(o.phone).trim() !== '' ? String(o.phone).trim() : '';
    const dealerPhone = o.dealer && o.dealer.phone != null && String(o.dealer.phone).trim() !== '' ? String(o.dealer.phone).trim() : '';
    const phone = stored || dealerPhone;
    return phone ? telLink(phone) : '<span class="muted">–</span>';
  };
  return `<div class="tablewrap"><table><thead><tr><th>#</th><th>Forhandler</th><th>Mobilnummer</th><th>Vare</th><th>Type</th><th>Pris (ekskl. moms)</th><th>Status</th><th>Oprettet</th><th>Udløber</th>${actions ? '<th>Handlinger</th>' : ''}</tr></thead><tbody>
  ${orders.map((o) => `<tr>${cell('#', o.id)}${cell('Forhandler', esc(o.dealer?.company_name || '—'))}${cell('Mobilnummer', mobile(o))}${cell('Vare', esc(o.item_label))}${cell('Type', L.kind[o.kind])}${cell('Pris (ekskl. moms)', dkk(o.price))}${cell('Status', pill(L.ostatus, o.status))}${cell('Oprettet', dt(o.created_at))}${cell('Udløber', o.status === 'pending' && !o.archived_at ? dt(o.expires_at) : '—')}
  ${actions ? cell('Handlinger', buttons(o), 'act') : ''}</tr>`).join('')}</tbody></table></div>`;
}
async function ordersPage() {
  adminShell('/dashboard/orders', `<div class="pagehead"><h1>Ordrer</h1></div><div class="filters"><select id="st"><option value="">Alle aktive ordrer</option>${Object.entries(L.ostatus).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}<option value="archived">Arkiv</option></select></div><p class="muted">Slet arkiverer ordren og lader en solgt bil være solgt. Sæt til salg igen annullerer den handel, gør bilen tilgængelig og sletter kun den ordres købsaftale. I arkivet sletter Slet permanent, og kun en ordre der allerede er arkiveret kan slettes sådan.</p><div id="msg"></div><div id="tbl"></div><h2>Salgslog</h2><div id="resale-log"></div>${resaleDialog()}`);
  const load = async () => {
    try {
      const st = sel('#st').value;
      const q = st === 'archived' ? '?archived=1' : (st ? '?status=' + st : '');
      const r = await api('GET', '/api/admin/orders' + q);
      sel('#tbl').innerHTML = ordersTable(r.orders, st === 'archived' ? 'archived' : 'full');
      const log = await api('GET', '/api/admin/resale-log');
      sel('#resale-log').innerHTML = resaleLogTable(log.log || []);
    } catch (e) { showErr(sel('#msg'), e); }
  };
  sel('#st').onchange = load;
  sel('#tbl').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    const archive = e.target.closest('[data-archive]');
    const restore = e.target.closest('[data-restore]');
    const purge = e.target.closest('[data-purge-order]');
    try {
      if (act) {
        const txt = { confirm: 'Bekræft', complete: 'Gennemfør', cancel: 'Annuller' }[act.dataset.act];
        if (!confirm(`${txt} ordre #${act.dataset.id}?`)) return;
        await api('POST', `/api/admin/orders/${act.dataset.id}/${act.dataset.act}`, {});
      } else if (archive) {
        if (!confirmArchive(archive.dataset.archive)) return;
        await api('POST', '/api/admin/orders/' + archive.dataset.archive + '/archive', {});
      } else if (restore) {
        if (!confirm(`Gendan ordre #${restore.dataset.restore}? Købsaftalen ændres ikke.`)) return;
        await api('POST', '/api/admin/orders/' + restore.dataset.restore + '/restore', {});
      } else if (purge) {
        if (!confirmPurge()) return;
        const r = await api('DELETE', '/api/admin/archived/orders/' + purge.dataset.purgeOrder);
        sel('#msg').innerHTML = r.message ? `<div class="notice">${esc(r.message)}</div>` : '<div class="ok">Slettet.</div>';
        load();
        return;
      } else return;
      sel('#msg').innerHTML = '';
      load();
    } catch (err) { showErr(sel('#msg'), err); }
  });
  load();
}
async function orderEdit(id) {
  adminShell('/dashboard/orders', '<h1>Indlæser…</h1>');
  let o;
  try { o = (await api('GET', '/api/orders/' + id)).order; }
  catch (e) { return adminShell('/dashboard/orders', `<div class="err">${esc(e.message)}</div>`); }
  const ag = o.agreement;
  const locked = !!o.archived_at;
  const expiresValue = o.expires_at ? o.expires_at.slice(0, 16) : '';
  adminShell('/dashboard/orders', `<div class="pagehead"><h1>Ordre #${o.id}</h1>${btnLink('/dashboard/orders', 'Tilbage', 'outline')}</div><div id="msg"></div>
    <div class="notice">Slet på ordrelisterne arkiverer ordren. Den forsvinder fra oversigten og tællingerne. Købsaftalen og sælgeren i aftalen ændres ikke. En afventende reservation frigives. En bekræftet eller gennemført handel sætter ikke bilen til salg igen. Arkivet kan gendanne ordren.</div>
    <div class="formcard"><h2>Ordre</h2>
      <p>Forhandler: <b>${esc(o.dealer?.company_name || '—')}</b>${o.dealer?.phone ? ` · ${telLink(o.dealer.phone)}` : ''} · ${esc(L.kind[o.kind])} · ${pill(L.ostatus, o.status)}${locked ? ' · Arkiveret' : ''}</p>
      <p>${ag ? `Aftale ${esc(ag.number)} · sælger ${esc(ag.seller && ag.seller.name)} · aftalt pris ${dkk(ag.price_excl_vat)}. ${btnLink('/agreement/' + o.id, 'Åbn aftale', 'small outline')}` : 'Ingen købsaftale på denne ordre.'}</p>
      <p class="muted">Aftalens tekst, sælger og aftalte pris kan ikke overskrives her.</p>
    </div>
    <form id="meta" class="formcard" novalidate><h2>Almindelige oplysninger</h2>
      <label>Vare</label><input name="item_label" required maxlength="200" value="${esc(o.item_label || '')}" ${locked ? 'disabled' : ''}>
      <label>Intern note</label><textarea name="admin_note" maxlength="1000" rows="3" ${locked ? 'disabled' : ''}>${esc(o.admin_note || '')}</textarea>
      ${o.kind === 'reserve' && o.status === 'pending' && !locked ? `<label>Reservation udløber</label><input type="datetime-local" name="expires_at" value="${esc(expiresValue)}">` : ''}
      ${locked ? '<p class="muted">Gendan ordren før den kan redigeres.</p>' : '<button class="btn" type="submit">Gem oplysninger</button>'}
    </form>
    <form id="price" class="formcard" novalidate><h2>Prisrettelse</h2>
      <p class="muted">Dette ændrer kun den registrerede ordrepris og gemmer den gamle pris med en begrundelse. Købsaftalen ændres ikke.</p>
      <label>Registreret pris (DKK, ekskl. moms)</label><input type="number" min="1" name="price" required value="${o.price}" ${locked ? 'disabled' : ''}>
      <label>Begrundelse</label><input name="correction_reason" maxlength="500" ${locked ? 'disabled' : ''} placeholder="Hvorfor prisen rettes">
      ${(o.corrections || []).length ? `<ul>${o.corrections.map((c) => `<li>${esc(dt(c.created_at))}: ${dkk(c.previous_price)} → ${dkk(c.new_price)} · ${esc(c.reason)}</li>`).join('')}</ul>` : ''}
      ${locked ? '' : '<button class="btn outline" type="submit">Registrer prisrettelse</button>'}
    </form>
    <div class="order-actions"><p class="archive-actions">${locked ? `<button type="button" class="btn" id="restore">Gendan</button><button type="button" class="btn danger" id="purge">Slet permanent</button>` : `<button type="button" class="btn danger" id="archive">Slet</button>`}</p>${resaleButtons(o) ? `<div class="resale-actions">${resaleButtons(o)}</div>` : ''}</div>${resaleDialog()}`);
  const meta = sel('#meta');
  if (meta && !locked) meta.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (!String(d.item_label || '').trim()) return showErr(sel('#msg'), new Error('Vare er påkrævet'));
    if (d.expires_at && o.expires_at && d.expires_at === String(o.expires_at).slice(0, 16)) d.expires_at = o.expires_at;
    try { await api('PUT', '/api/admin/orders/' + id, d); orderEdit(id); } catch (err) { showErr(sel('#msg'), err); }
  });
  const price = sel('#price');
  if (price && !locked) price.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (!String(d.correction_reason || '').trim()) return showErr(sel('#msg'), new Error('Begrundelse er påkrævet'));
    if (!confirm('Registrer prisrettelse? Købsaftalen ændres ikke.')) return;
    try { await api('PUT', '/api/admin/orders/' + id, { price: Number(d.price), correction_reason: d.correction_reason }); orderEdit(id); } catch (err) { showErr(sel('#msg'), err); }
  });
  const archive = sel('#archive');
  if (archive) archive.onclick = async () => {
    if (!confirmArchive(id)) return;
    try { await api('POST', '/api/admin/orders/' + id + '/archive', {}); go('/dashboard/orders'); } catch (err) { showErr(sel('#msg'), err); }
  };
  const restore = sel('#restore');
  if (restore) restore.onclick = async () => {
    if (!confirm('Gendan ordre #' + id + '? Købsaftalen ændres ikke.')) return;
    try { await api('POST', '/api/admin/orders/' + id + '/restore', {}); orderEdit(id); } catch (err) { showErr(sel('#msg'), err); }
  };
  const purge = sel('#purge');
  if (purge) purge.onclick = async () => {
    if (!confirmPurge()) return;
    try {
      const r = await api('DELETE', '/api/admin/archived/orders/' + id);
      if (r.deleted) go('/dashboard/orders');
      else {
        sel('#msg').innerHTML = `<div class="notice">${esc(r.message || 'Ordren er fjernet fra arkivet. Købsaftalen er bevaret.')}</div>`;
        purge.disabled = true;
      }
    } catch (err) { showErr(sel('#msg'), err); }
  };
}

// ---------- admin: dealers ----------
function tierLabel(t) {
  return { owner: 'Ejer', head: 'Hovedadmin', admin: 'Admin', dealer: 'Forhandler' }[t] || 'Forhandler';
}
function tierBadge(t) {
  const tier = t || 'dealer';
  return `<span class="tier ${esc(tier)}">${esc(tierLabel(tier))}</span>`;
}
function canManageAdmins() {
  return !!(S.user && (S.user.can_manage_admins === true || (S.user.can_manage_admins == null && isStaff(S.user))));
}
function canGrantHead() { return !!(S.user && S.user.can_grant_head); }
function tierButtons(d) {
  const tier = d.tier || (d.role === 'admin' ? 'admin' : 'dealer');
  if (tier === 'owner') return '';
  let html = '';
  if (canGrantHead() && tier === 'head') html += `<button type="button" class="btn small outline" data-head="0" data-id="${d.id}">Fjern hovedadmin</button>`;
  else if (canGrantHead()) html += `<button type="button" class="btn small outline" data-head="1" data-id="${d.id}">Gør til hovedadmin</button>`;
  if (canManageAdmins() && tier === 'dealer') html += `<button type="button" class="btn small" data-promote="${d.id}">Gør til admin</button>`;
  if (canManageAdmins() && tier === 'admin') html += `<button type="button" class="btn small danger" data-demote="${d.id}">Fjern admin</button>`;
  return html;
}
function foldDa(value) {
  return String(value || '').toLocaleLowerCase('da-DK').replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa');
}
function filterDealers(dealers, opts) {
  const q = foldDa(opts && opts.q);
  const status = (opts && opts.status) || 'all';
  const seen = (opts && opts.seen) || 'all';
  const nowMs = opts && opts.nowMs ? opts.nowMs : Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const month = 30 * 24 * 60 * 60 * 1000;
  return (dealers || []).filter((d) => {
    if (status !== 'all' && d.status !== status) return false;
    const seenAt = d.last_seen_at ? Date.parse(d.last_seen_at) : NaN;
    if (seen === 'never' && d.last_seen_at) return false;
    if (seen === '7d' && !(Number.isFinite(seenAt) && nowMs - seenAt <= week)) return false;
    if (seen === '30d' && !(Number.isFinite(seenAt) && nowMs - seenAt >= month)) return false;
    if (!q) return true;
    const hay = foldDa([d.name, d.company_name, d.cvr, d.email, d.phone, d.city].join('\n'));
    return hay.includes(q);
  });
}
async function dealersPage() {
  adminShell('/dashboard/dealers', '<h1>Indlæser…</h1>');
  const [{ dealers }, staff] = await Promise.all([api('GET', '/api/admin/dealers'), api('GET', '/api/admin/admins')]);
  const admins = staff.admins || [];
  let seenFirst = false;
  const filters = { q: '', status: 'all', seen: 'all' };
  const paint = () => {
    const qEl = document.getElementById('dq');
    const keepFocus = qEl && document.activeElement === qEl;
    const caret = keepFocus ? qEl.selectionStart : null;
    if (qEl) filters.q = qEl.value;
    const statusEl = document.getElementById('dstatus');
    const seenEl = document.getElementById('dseen');
    if (statusEl) filters.status = statusEl.value;
    if (seenEl) filters.seen = seenEl.value;
    const matched = filterDealers(dealers, filters);
    const matchedAdmins = filterDealers(admins, filters);
    const rows = seenFirst ? [...matched].sort((a, b) => String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || '')) || b.id - a.id) : matched;
    const adminRows = seenFirst ? [...matchedAdmins].sort((a, b) => String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || '')) || b.id - a.id) : matchedAdmins;
    const seenCell = (d) => esc(sidstAktiv(d.last_seen_at)).replace(' kl. ', '<br>kl. ');
    const sect = (title, st, list, acts) => `<h2>${title} (${list.length})</h2>${list.length ? `<div class="tablewrap"><table class="dealers"><thead><tr><th>Firma</th><th>CVR</th><th>By</th><th>Mobilnummer</th><th>E-mail</th><th>Ansøgt</th><th>Sidst aktiv</th><th>Status</th><th>Handlinger</th></tr></thead><tbody>${list.map((d) => `<tr>${cell('Firma', `<b>${esc(d.company_name || d.name)}</b> ${tierBadge(d.tier)}`)}${cell('CVR', esc(d.cvr || '—'))}${cell('By', esc(d.city || '—'))}${cell('Mobilnummer', d.phone ? telLink(d.phone) : '—')}${cell('E-mail', esc(d.email))}${cell('Ansøgt', dt(d.created_at))}${cell('Sidst aktiv', seenCell(d))}${cell('Status', pill(L.dstatus, d.status))}${cell('Handlinger', (d.tier === 'owner' || d.tier === 'head' ? '' : acts(d)) + tierButtons(d), 'act')}</tr>`).join('')}</tbody></table></div>` : `<div class="tablewrap"><div class="empty">Ingen.</div></div>`}<br>`;
    const adminTable = adminRows.length ? `<h2>Administratorer (${adminRows.length})</h2><div class="tablewrap"><table class="dealers"><thead><tr><th>Navn</th><th>E-mail</th><th>Sidst aktiv</th><th>Rolle</th><th>Handlinger</th></tr></thead><tbody>${adminRows.map((d) => `<tr>${cell('Navn', `<b>${esc(d.name)}</b>`)}${cell('E-mail', esc(d.email))}${cell('Sidst aktiv', seenCell(d))}${cell('Rolle', tierBadge(d.tier))}${cell('Handlinger', tierButtons(d) || '—', 'act')}</tr>`).join('')}</tbody></table></div>` : '';
    const by = (s) => rows.filter((d) => d.status === s);
    const show = (st) => filters.status === 'all' || filters.status === st;
    const dealerSections = `${show('pending') ? sect('Afventende Ansøgninger', 'pending', by('pending'), (d) => `${btnLink('/dashboard/dealers/' + d.id + '/edit', 'Rediger', 'small outline')}<button type="button" class="btn small" data-a="approve" data-id="${d.id}" aria-label="Godkend ${esc(d.company_name)}">Godkend</button><button type="button" class="btn small danger" data-a="reject" data-id="${d.id}" aria-label="Afvis ${esc(d.company_name)}">Afvis</button>`) : ''}${show('approved') ? sect('Godkendte Forhandlere', 'approved', by('approved'), (d) => `${btnLink('/dashboard/dealers/' + d.id + '/edit', 'Rediger', 'small outline')}<button type="button" class="btn small danger" data-a="reject" data-id="${d.id}" aria-label="Afvis ${esc(d.company_name)}">Afvis</button>`) : ''}${show('rejected') ? sect('Afviste', 'rejected', by('rejected'), (d) => `<span class="dealer-actions">${btnLink('/dashboard/dealers/' + d.id + '/edit', 'Rediger', 'small outline')}<button type="button" class="btn small outline" data-a="approve" data-id="${d.id}" aria-label="Godkend ${esc(d.company_name)}">Godkend</button><button type="button" class="btn small danger" data-purge-dealer="${d.id}" data-name="${esc(d.company_name || d.name || '')}">Slet</button></span>`) : ''}`;
    const sections = (rows.length || adminRows.length) ? dealerSections : '<div class="tablewrap"><div class="empty">Ingen forhandlere matcher</div></div>';
    adminShell('/dashboard/dealers', `<div class="pagehead"><h1>Forhandlerstyring</h1><button type="button" class="btn small outline" id="sortseen" aria-pressed="${seenFirst ? 'true' : 'false'}">${seenFirst ? 'Nyeste ansøgninger først' : 'Sidst aktiv først'}</button></div>
      <div class="filters dealer-filters"><input id="dq" type="search" placeholder="Søg navn, firma, CVR, e-mail, telefon eller by" value="${esc(filters.q)}" aria-label="Søg forhandlere"><select id="dstatus" aria-label="Status"><option value="all">Alle</option><option value="approved">Aktiv</option><option value="pending">Afventer</option><option value="rejected">Afvist</option></select><select id="dseen" aria-label="Sidst aktiv"><option value="all">Alle</option><option value="never">Aldrig logget ind</option><option value="7d">Aktiv seneste 7 dage</option><option value="30d">Ikke aktiv i 30+ dage</option></select></div>
      <p class="muted" id="dcount">${rows.length + adminRows.length} forhandlere</p><div id="msg"></div>
      ${sections}
      ${adminTable}
      ${canManageAdmins() ? `<form id="af" class="formcard" novalidate><h2>Opret admin</h2><p class="muted" style="margin-top:0">Kun ejeren og en hovedadmin kan oprette en almindelig administrator.</p>
        <div class="grid2"><div><label>Navn</label><input name="name" required></div><div><label>E-mail</label><input type="email" name="email" required></div><div><label>Adgangskode (min. 4 tegn)</label><input type="password" name="password" minlength="4" required autocomplete="new-password"></div></div>
        <button class="btn" style="margin-top:1rem">Opret admin</button><div id="am"></div></form>` : ''}`);
    document.getElementById('dstatus').value = filters.status;
    document.getElementById('dseen').value = filters.seen;
    const search = document.getElementById('dq');
    search.addEventListener('input', paint);
    document.getElementById('dstatus').addEventListener('change', paint);
    document.getElementById('dseen').addEventListener('change', paint);
    if (keepFocus) { search.focus(); if (caret != null) search.setSelectionRange(caret, caret); }
    document.querySelector('.main').addEventListener('click', async (e) => {
      if (e.target.closest('#sortseen')) { seenFirst = !seenFirst; paint(); return; }
      const head = e.target.closest('[data-head]');
      const promote = e.target.closest('[data-promote]');
      const demote = e.target.closest('[data-demote]');
      const purge = e.target.closest('[data-purge-dealer]');
      const b = e.target.closest('[data-a]');
      try {
        if (head) { await api('POST', `/api/admin/users/${head.dataset.id}/head`, { grant: head.dataset.head === '1' }); dealersPage(); return; }
        if (promote) { if (!confirm('Gør brugeren til administrator?')) return; await api('POST', `/api/admin/users/${promote.dataset.promote}/promote`, {}); dealersPage(); return; }
        if (demote) { if (!confirm('Fjern administratoradgangen? Brugeren bliver forhandler. Biler, ordrer og aftaler ændres ikke.')) return; await api('POST', `/api/admin/users/${demote.dataset.demote}/demote`, {}); dealersPage(); return; }
        if (purge) {
          if (!confirm(`Slet den afviste ansøger "${purge.dataset.name || ''}"? Dette kan ikke fortrydes.`)) return;
          await api('POST', `/api/admin/dealers/${purge.dataset.purgeDealer}/delete`, { confirm: true });
          dealersPage();
          return;
        }
        if (!b) return;
        await api('POST', `/api/admin/dealers/${b.dataset.id}/${b.dataset.a}`, {});
        dealersPage();
      } catch (err) { showErr(sel('#msg'), err); }
    });
    const adminForm = sel('#af');
    if (adminForm) adminForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fields = Object.fromEntries(new FormData(e.target));
      if (String(fields.password || '').length < 4) return showErr(sel('#am'), new Error('Adgangskoden skal være mindst 4 tegn'));
      try { const r = await api('POST', '/api/admin/admins', fields); e.target.reset(); sel('#am').innerHTML = `<div class="ok">Administrator ${esc(r.admin.email)} er oprettet.</div>`; } catch (err) { showErr(sel('#am'), err); }
    });
  };
  paint();
}

// ---------- dealer shop ----------
function cartIcon(active) {
  const on = active === '/shop/cart';
  return `<a data-link class="cartlink${on ? ' active' : ''}" href="/shop/cart" aria-label="Kurv" ${on ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M6 7h15l-1.6 8.2a1 1 0 0 1-1 .8H8.2a1 1 0 0 1-1-.8L5.2 4H2"/><circle cx="9" cy="20" r="1.4" fill="currentColor"/><circle cx="17" cy="20" r="1.4" fill="currentColor"/></svg><span id="cartcount">0</span></a>`;
}
function setCartCount(n) {
  const el = document.getElementById('cartcount');
  if (el) el.textContent = String(n || 0);
}
function shopShell(active, inner, unread = 0) {
  const nav = [['/shop', 'Biler'], ['/shop/packages', 'Partier'], ['/shop/orders', 'Mine ordrer'], ['/account/profile', 'Profil']];
  $app.innerHTML = `<header class="shopbar">${brandLink()}<nav aria-label="Forhandler">${nav.map(([h, t]) => `<a data-link href="${esc(h)}" class="${h === active ? 'active' : ''}" ${h === active ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
   <div class="sp">${cartIcon(active)}<span>${esc(S.user.company_name || S.user.name)}</span><button type="button" id="lo">Log Ud</button></div></header><main class="shopmain">${inner}</main>`;
  document.getElementById('lo').onclick = logout;
  api('GET', '/api/shop/cart').then((r) => setCartCount(r.cart.count)).catch(() => {});
}
function holdPage() {
  const rej = S.user.status === 'rejected';
  $app.innerHTML = `<header class="shopbar">${brandLink()}<div class="sp"><span>${esc(S.user.email)}</span><button type="button" id="lo">Log Ud</button></div></header>
  <main class="shopmain"><div class="authbox" style="margin:3rem auto"><h1>${rej ? 'Din ansøgning er afvist' : 'Din ansøgning afventer godkendelse'}</h1>
  <p>${rej ? 'Din forhandlerkonto er desværre ikke blevet godkendt, og du har derfor ikke adgang til kataloget.' : 'Vi gennemgår din ansøgning. Du får adgang til biler og partier, så snart din konto er godkendt.'}</p>
  ${rej ? '' : '<p class="muted">Opdater siden for at se, om kontoen er blevet godkendt.</p>'}
  <p>${btnLink('/account/profile', 'Profil', 'outline')} ${btnLink('/account/profile#skift-adgangskode', 'Skift adgangskode', 'outline')}</p></div></main>`;
  document.getElementById('lo').onclick = logout;
}
const carImg = (v) => (v.images && v.images[0] && !v.images[0].endsWith('.heic') ? `<img src="${esc(v.images[0])}" alt="">` : '🚗');
function cardCartAction(v, inCart) {
  const details = btnLink('/shop/vehicles/' + v.id, 'Se detaljer', 'small');
  if (!inCart) return `<div class="vactions">${details}<button type="button" class="btn small" data-add="${v.id}">Tilføj til kurv</button></div>`;
  return `<div class="vactions">${details}<span class="in-cart">I kurven</span><button type="button" class="btn small outline" data-drop="${v.id}" aria-label="Fjern ${esc(v.make)} ${esc(v.model)} fra kurven">Fjern</button></div>`;
}
async function shopHome() {
  shopShell('/shop', `<div class="pagehead"><h1>Biler</h1></div><div id="nt"></div>
   <div class="filters"><input id="q" placeholder="Søg mærke eller model…"><select id="fu"><option value="">Alle brændstoftyper</option>${Object.entries(L.fuel).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div id="msg"></div><div id="lst"></div>`);
  try {
    const n = (await api('GET', '/api/shop/notifications')).notifications.filter((x) => !x.read);
    if (n.length) { sel('#nt').innerHTML = `<div class="notice">${n.map((x) => `🔔 ${link(x.link || '/shop/packages', esc(x.message))}`).join('<br>')} <button class="btn small outline" id="mr" style="margin-left:.6rem">Marker som læst</button></div>`; sel('#mr').onclick = async () => { await api('POST', '/api/shop/notifications/read', {}); sel('#nt').innerHTML = ''; }; }
  } catch {}
  const load = async () => {
    if (!sel('#q')) return;
    const p = new URLSearchParams(); if (sel('#q').value) p.set('q', sel('#q').value); if (sel('#fu').value) p.set('fuel', sel('#fu').value);
    try {
      const [r, cart] = await Promise.all([api('GET', '/api/shop/vehicles?' + p), api('GET', '/api/shop/cart')]);
      const chosen = new Set(cart.cart.vehicles.map((v) => v.id));
      setCartCount(cart.cart.count);
      sel('#lst').innerHTML = r.vehicles.length ? `<div class="vgrid">${r.vehicles.map((v) => `<div class="vcard"><div class="img">${carImg(v)}</div><div class="bd"><h3>${esc(v.make)} ${esc(v.model)}</h3><div class="vsub">${esc(v.variant || '')}</div><div class="vmeta">${[v.first_registration ? v.first_registration.slice(0, 4) : '', v.mileage != null ? num(v.mileage) + ' km' : '', L.fuel[v.fuel] || ''].filter(Boolean).join(' · ')}</div><div class="price">${dkk(v.price)} <small>ekskl. moms</small></div>${cardCartAction(v, chosen.has(v.id))}</div></div>`).join('')}</div>` : '<div class="empty">Der er ingen tilgængelige biler lige nu.</div>';
    } catch (e) { showErr(sel('#msg'), e); }
  };
  sel('#lst').addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    const drop = e.target.closest('[data-drop]');
    try {
      if (add) await api('POST', '/api/shop/cart', { vehicle_ids: [Number(add.dataset.add)] });
      else if (drop) await api('DELETE', '/api/shop/cart/vehicles/' + drop.dataset.drop);
      else return;
      await load();
    } catch (err) { showErr(sel('#msg'), err); }
  });
  sel('#q').addEventListener('input', debounce(load)); sel('#fu').onchange = load; load();
}
async function shopCart() {
  shopShell('/shop/cart', '<div class="pagehead"><h1>Kurv</h1></div><p>Indlæser…</p>');
  let cart;
  try { cart = (await api('GET', '/api/shop/cart')).cart; }
  catch (e) { return shopShell('/shop/cart', `<div class="err">${esc(e.message)}</div>`); }
  setCartCount(cart.count);
  const lines = cart.vehicles.length ? cart.vehicles.map((v) => `<div class="cartline${v.available ? '' : ' unavailable'}"><div><b>${esc(v.make)} ${esc(v.model)}</b><div class="muted">${esc(v.vin)}${v.available ? '' : ' · ikke længere tilgængelig'}</div></div><div class="cartline-end"><div class="price">${dkk(v.price)} <small>ekskl. moms</small></div><button type="button" class="btn small outline" data-drop="${v.id}">Fjern</button></div></div>`).join('') : '<div class="empty">Kurven er tom.</div>';
  shopShell('/shop/cart', `<div class="pagehead"><h1>Kurv</h1>${link('/shop', '← Biler')}</div><div id="msg"></div>${lines}
    ${cart.count ? `<div class="formcard"><p>Pris ekskl. moms: <b>${dkk(cart.price_excl_vat)}</b></p><p>Moms (${cart.vat_rate * 100}%): <b>${dkk(cart.vat)}</b></p><p>I alt inkl. moms: <b>${dkk(cart.total_incl_vat)}</b></p><p><button type="button" class="btn" id="bestil">Bestil samlet</button></p></div>` : ''}`);
  setCartCount(cart.count);
  document.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('DELETE', '/api/shop/cart/vehicles/' + b.dataset.drop); shopCart(); }
    catch (err) { showErr(sel('#msg'), err); }
  }));
  if (sel('#bestil')) sel('#bestil').onclick = async () => {
    if (!confirm('Bestil bilerne samlet? Der oprettes én ordre og én købsaftale.')) return;
    try {
      const o = (await api('POST', '/api/shop/cart/buy', {})).order;
      go('/agreement/' + o.id);
    } catch (err) { showErr(sel('#msg'), err); }
  };
}
async function shopVehicle(id) {
  shopShell('/shop', '<p>Indlæser…</p>');
  let r; try { r = await api('GET', '/api/shop/vehicles/' + id); } catch (e) { return shopShell('/shop', `<div class="err">${esc(e.message)}</div>${btnLink('/shop', '← Tilbage')}`); }
  const v = r.vehicle; const row = (k, val) => (val ? `<tr><td>${k}</td><td>${esc(val)}</td></tr>` : '');
  shopShell('/shop', `${link('/shop', '← Alle biler')}<div class="detail" style="margin-top:1rem"><div class="gallery">${v.images.length ? v.images.map((u) => (u.endsWith('.heic') ? `<a href="${esc(u)}">Se billede (HEIC)</a>` : `<img src="${esc(u)}" alt="">`)).join('') : '<div class="vcard"><div class="img">🚗</div></div>'}</div>
   <div><h1>${esc(v.make)} ${esc(v.model)}</h1><div class="muted">${esc(v.variant || '')}</div><div class="price" style="margin:1rem 0">${dkk(v.price)} <small>engrospris ekskl. moms</small></div>
   <table class="spec">${row('VIN', v.vin)}${row('Første registrering', v.first_registration)}${row('Kilometer', v.mileage != null ? num(v.mileage) + ' km' : '')}${row('Brændstof', L.fuel[v.fuel])}${row('Gearkasse', L.gear[v.transmission])}${row('Farve', v.color)}</table>
   ${v.condition_report_url ? `<p><a href="${esc(v.condition_report_url)}" target="_blank" rel="noopener noreferrer">📄 Se tilstandsrapport</a></p>` : ''}
   <div id="msg"></div>${r.my_reservation ? `<div class="notice">Du har reserveret denne bil indtil ${dt(r.my_reservation.expires_at)}.</div>` : `<button class="btn outline" id="rs">Reserver i 24 timer</button> `}<button class="btn" id="by">Køb nu</button>
   <p class="muted" style="font-size:.82rem">Reservation holder bilen i 24 timer. Ved køb genereres en købsaftale automatisk.</p></div></div>`);
  const act = async (kind, q) => {
    if (!confirm(q)) return;
    try { const o = (await api('POST', `/api/shop/vehicles/${id}/${kind}`, {})).order; go(kind === 'buy' ? '/agreement/' + o.id : '/shop/orders'); } catch (e) { showErr(sel('#msg'), e); }
  };
  if (sel('#rs')) sel('#rs').onclick = () => act('reserve', 'Reserver denne bil i 24 timer?');
  sel('#by').onclick = () => act('buy', 'Køb denne bil nu? Der genereres en bindende købsaftale.');
}
async function shopPackages() {
  shopShell('/shop/packages', '<div class="pagehead"><h1>Partier</h1></div><div id="lst">Indlæser…</div>');
  try {
    const r = await api('GET', '/api/shop/packages');
    sel('#lst').innerHTML = r.packages.length ? `<div class="cards" style="margin-top:0">${r.packages.map((p) => `<div class="card"><h3>${esc(p.name)}</h3><div class="muted">${p.vehicle_count} biler</div><p>${esc(p.description || '')}</p><div class="price">${dkk(p.total_price)} <small>ekskl. moms</small></div><br>${btnLink('/shop/packages/' + p.id, 'Se parti', 'small')}</div>`).join('')}</div>` : '<div class="empty">Der er ingen tilgængelige partier lige nu.</div>';
  } catch (e) { showErr(sel('#lst'), e); }
}
async function shopPackage(id) {
  shopShell('/shop/packages', '<p>Indlæser…</p>');
  let p; try { p = (await api('GET', '/api/shop/packages/' + id)).package; } catch (e) { return shopShell('/shop/packages', `<div class="err">${esc(e.message)}</div>${btnLink('/shop/packages', '← Tilbage')}`); }
  shopShell('/shop/packages', `${link('/shop/packages', '← Alle partier')}<h1 style="margin-top:1rem">${esc(p.name)}</h1><p>${esc(p.description || '')}</p><div class="price">${dkk(p.total_price)} <small>samlet pris ekskl. moms</small></div>
   <h2 style="margin-top:1.5rem">Biler i partiet (${p.vehicle_count})</h2>${p.vehicles.length ? `<div class="tablewrap"><table><thead><tr><th>Mærke / Model</th><th>VIN</th><th>Km</th><th>Brændstof</th></tr></thead><tbody>${p.vehicles.map((v) => `<tr>${cell('Mærke / Model', `${esc(v.make)} ${esc(v.model)} ${esc(v.variant || '')}`)}${cell('VIN', esc(v.vin))}${cell('Km', v.mileage != null ? num(v.mileage) : '—')}${cell('Brændstof', esc(L.fuel[v.fuel] || '—'))}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">Bilerne i partiet specificeres efter aftale.</p>'}
   <div id="msg"></div><p><button class="btn outline" id="rs">Reserver i 24 timer</button> <button class="btn" id="by">Køb nu</button></p>`);
  const act = async (kind, q) => { if (!confirm(q)) return; try { const o = (await api('POST', `/api/shop/packages/${id}/${kind}`, {})).order; go(kind === 'buy' ? '/agreement/' + o.id : '/shop/orders'); } catch (e) { showErr(sel('#msg'), e); } };
  sel('#rs').onclick = () => act('reserve', 'Reserver hele partiet i 24 timer?'); sel('#by').onclick = () => act('buy', 'Køb hele partiet nu? Der genereres en bindende købsaftale.');
}
async function shopOrders() {
  shopShell('/shop/orders', '<div class="pagehead"><h1>Mine ordrer</h1></div><div id="msg"></div><div id="lst">Indlæser…</div>');
  const load = async () => {
    try {
      const r = await api('GET', '/api/shop/orders');
      sel('#lst').innerHTML = r.orders.length ? `<div class="tablewrap"><table><thead><tr><th>#</th><th>Vare</th><th>Type</th><th>Pris (ekskl. moms)</th><th>Status</th><th>Oprettet</th><th>Reserveret til</th><th>Handlinger</th></tr></thead><tbody>${r.orders.map((o) => `<tr>${cell('#', o.id)}${cell('Vare', esc(o.item_label))}${cell('Type', L.kind[o.kind])}${cell('Pris (ekskl. moms)', dkk(o.price))}${cell('Status', pill(L.ostatus, o.status))}${cell('Oprettet', dt(o.created_at))}${cell('Reserveret til', o.status === 'pending' && !o.archived_at ? dt(o.expires_at) : '—')}${cell('Handlinger', `${o.has_agreement ? btnLink('/agreement/' + o.id, 'Se aftale', 'small outline') : ''}${o.status === 'pending' && !o.archived_at ? `<button type="button" class="btn small outline" data-cancel="${o.id}" aria-label="Annuller ordre ${o.id}">Annuller</button>` : ''}`, 'act')}</tr>`).join('')}</tbody></table></div>` : '<div class="empty">Du har ingen ordrer endnu.</div>';
    } catch (e) { showErr(sel('#msg'), e); }
  };
  sel('#lst').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cancel]'); if (!b || !confirm('Annuller denne reservation?')) return;
    try { await api('POST', `/api/shop/orders/${b.dataset.cancel}/cancel`, {}); load(); } catch (err) { showErr(sel('#msg'), err); }
  });
  load();
}

// ---------- agreement ----------
async function agreementPage(id) {
  const wrapper = (inner) => (isStaff(S.user) ? adminShell('/dashboard/orders', inner) : shopShell('/shop/orders', inner));
  wrapper('<p>Indlæser…</p>');
  let o; try { o = (await api('GET', '/api/orders/' + id)).order; } catch (e) { return wrapper(`<div class="err">${esc(e.message)}</div>`); }
  const a = o.agreement; if (!a) return wrapper('<div class="notice">Denne ordre har endnu ingen købsaftale (kun reservation).</div>');
  wrapper(`<p class="noprint">${link(isStaff(S.user) ? '/dashboard/orders' : '/shop/orders', '← Tilbage til ordrer')} · <a href="#" id="pr">Print</a></p>
  <div class="agreement"><h1>Købsaftale</h1><p class="muted">Aftalenr. <b>${esc(a.number)}</b> · ${dt(a.date)}</p>
  <h3>Sælger</h3><p>${sellerBlock(a.seller)}</p>
  <h3>Køber</h3><p>${esc(a.buyer.company)}<br>CVR: ${esc(a.buyer.cvr)} · ${esc(a.buyer.city)}<br>Kontakt: ${esc(a.buyer.contact)} (${esc(a.buyer.email)})${a.buyer.phone ? `<br>Mobilnummer: ${telLink(a.buyer.phone)}` : ''}</p>
  <h3>Genstand: ${esc(a.subject)}</h3><div class="tablewrap"><table><thead><tr><th>Køretøj</th><th>VIN</th><th style="text-align:right">${a.package_breakdown ? 'Katalogpris' : 'Pris'}</th></tr></thead><tbody>${a.items.map((i) => `<tr>${cell('Køretøj', esc(i.description))}${cell('VIN', esc(i.vin))}${cell(a.package_breakdown ? 'Katalogpris' : 'Pris', i.price ? dkk(i.price) : '')}</tr>`).join('')}</tbody></table></div>
  <table class="spec" style="margin-top:1rem">${a.package_breakdown ? `<tr><td>Sum af katalogpriser</td><td style="text-align:right">${dkk(a.package_breakdown.catalog_sum)}</td></tr><tr><td>${a.package_breakdown.adjustment < 0 ? 'Prisjustering (rabat)' : a.package_breakdown.adjustment > 0 ? 'Prisjustering (tillæg)' : 'Prisjustering'}</td><td style="text-align:right">${dkk(a.package_breakdown.adjustment)}</td></tr><tr><td>Aftalt pakkepris ekskl. moms</td><td style="text-align:right">${dkk(a.price_excl_vat)}</td></tr>` : `<tr><td>Pris ekskl. moms</td><td style="text-align:right">${dkk(a.price_excl_vat)}</td></tr>`}<tr><td>Moms (${a.vat_rate * 100}%)</td><td style="text-align:right">${dkk(a.vat)}</td></tr><tr><td><b>I alt inkl. moms</b></td><td style="text-align:right"><b>${dkk(a.total_incl_vat)}</b></td></tr></table>
  <h3 style="margin-top:1.5rem">Vilkår</h3><ol>${a.terms.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>`);
  sel('#pr').onclick = (e) => { e.preventDefault(); window.print(); };
}

// ---------- password ----------
function passwordPage() {
  const minPw = Number(S.user.password_min_length) || 4;
  const inner = `<div class="pagehead"><h1>Skift adgangskode</h1></div>
    <form id="pf" class="formcard" novalidate style="max-width:32rem">
      <p class="muted" style="margin-top:0">Den nye adgangskode gælder med det samme og bevares, når serveren genstarter.</p>
      <label>Nuværende adgangskode</label><input type="password" name="current_password" required autocomplete="current-password">
      <label>Ny adgangskode</label><div class="muted" style="font-size:.8rem">Mindst ${minPw} tegn.</div><input type="password" name="new_password" required minlength="${minPw}" autocomplete="new-password">
      <button class="btn" type="submit">Gem ny adgangskode</button>
      <div id="pm"></div>
    </form>`;
  if (isStaff(S.user)) adminShell('/account/password', inner);
  else if (S.user.role === 'dealer' && S.user.status === 'approved') shopShell('/shop', inner);
  else {
    $app.innerHTML = `<header class="shopbar">${brandLink()}<div class="sp"><span>${esc(S.user.email)}</span><button type="button" id="lo">Log Ud</button></div></header><main class="shopmain">${inner}</main>`;
    document.getElementById('lo').onclick = logout;
  }
  document.getElementById('pf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (String(d.new_password || '').length < minPw) return showErr(document.getElementById('pm'), new Error(`Adgangskoden skal være mindst ${minPw} tegn`));
    try {
      await api('POST', '/api/auth/password', { current_password: d.current_password, new_password: d.new_password });
      e.target.reset();
      document.getElementById('pm').innerHTML = '<div class="ok">Adgangskoden er ændret.</div>';
    } catch (err) { showErr(document.getElementById('pm'), err); }
  });
}

async function packageEdit(id) {
  adminShell('/dashboard/packages', '<h1>Indlæser…</h1>');
  let pkg;
  let vehicles;
  try {
    pkg = (await api('GET', '/api/admin/packages/' + id)).package;
    vehicles = (await api('GET', '/api/admin/vehicles')).vehicles;
  } catch (e) { return adminShell('/dashboard/packages', `<div class="err">${esc(e.message)}</div>`); }
  if (pkg.status !== 'available') {
    return adminShell('/dashboard/packages', `<div class="pagehead"><h1>${esc(pkg.name)}</h1></div><div class="notice">Partiet kan ikke redigeres, mens det er reserveret eller solgt.</div>${btnLink('/dashboard/packages', 'Tilbage')}`);
  }
  const chosen = new Set(pkg.vehicles.map((v) => v.id));
  const choices = vehicles.filter((v) => v.status === 'available' || chosen.has(v.id));
  adminShell('/dashboard/packages', `<div class="pagehead"><h1>Rediger parti</h1>${btnLink('/dashboard/packages', 'Tilbage', 'outline')}</div><div id="msg"></div>
    <form id="f" class="formcard" novalidate>
      <label>Partinavn</label><input name="name" required maxlength="120" value="${esc(pkg.name)}">
      <label>Total pris (DKK, ekskl. moms)</label><input type="number" min="1" name="total_price" required value="${pkg.total_price}">
      <label>Beskrivelse</label><textarea name="description" maxlength="2000" rows="3">${esc(pkg.description || '')}</textarea>
      <label>Biler</label>
      <div class="pick">${choices.map((v) => `<label class="pick-row"><input type="checkbox" name="vid" value="${v.id}" ${chosen.has(v.id) ? 'checked' : ''}> ${esc(v.make)} ${esc(v.model)} <span class="muted">${esc(v.vin)}</span> ${dkk(v.price)}</label>`).join('') || '<p class="muted">Ingen ledige biler.</p>'}</div>
      <button class="btn" type="submit">Gem parti</button>
    </form>`);
  sel('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    d.vehicle_ids = [...document.querySelectorAll('#f input[name=vid]:checked')].map((el) => Number(el.value));
    delete d.vid;
    if (!d.vehicle_ids.length) return showErr(sel('#msg'), new Error('Vælg mindst én bil til partiet.'));
    try { await api('PUT', '/api/admin/packages/' + id, d); go('/dashboard/packages'); } catch (err) { showErr(sel('#msg'), err); }
  });
}
async function dealerEdit(id) {
  adminShell('/dashboard/dealers', '<h1>Indlæser…</h1>');
  let d;
  try {
    const rows = (await api('GET', '/api/admin/dealers')).dealers;
    d = rows.find((row) => String(row.id) === String(id));
    if (!d) throw new Error('Forhandler ikke fundet');
  } catch (e) { return adminShell('/dashboard/dealers', `<div class="err">${esc(e.message)}</div>`); }
  adminShell('/dashboard/dealers', `<div class="pagehead"><h1>Rediger forhandler</h1>${btnLink('/dashboard/dealers', 'Tilbage', 'outline')}</div><div id="msg"></div>
    <form id="f" class="formcard" novalidate>
      <p class="muted">Status ændres med Godkend og Afvis på listen. Adgangskode og rolle kan ikke ændres her.</p>
      <p>Mobilnummer: ${d.phone ? telLink(d.phone) : '—'}</p>
      <p>Sidst aktiv: ${esc(sidstAktiv(d.last_seen_at))}</p>
      <label>Firmanavn</label><input name="company_name" required maxlength="120" value="${esc(d.company_name || '')}">
      <label>CVR</label><input name="cvr" required maxlength="20" value="${esc(d.cvr || '')}">
      <label>By</label><input name="city" required maxlength="80" value="${esc(d.city || '')}">
      <label>Kontakt</label><input name="name" required maxlength="120" value="${esc(d.name || '')}">
      <label>E-mail</label><input type="email" name="email" required value="${esc(d.email || '')}">
      <button class="btn" type="submit">Gem forhandler</button>
    </form>`);
  sel('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(e.target));
    try { await api('PUT', '/api/admin/dealers/' + id, fields); go('/dashboard/dealers'); } catch (err) { showErr(sel('#msg'), err); }
  });
}

async function profilePage() {
  if (!S.user || S.user.role !== 'dealer') return go(S.user && isStaff(S.user) ? '/dashboard' : '/login', true);
  const minPw = Number(S.user.password_min_length) || 4;
  const inner = `<div class="pagehead"><h1>Profil</h1></div><div id="msg"></div>
    <form id="pf" class="formcard" novalidate style="max-width:32rem">
      <p class="muted" style="margin-top:0">${esc(S.user.company_name || S.user.name)} · ${esc(S.user.email)}</p>
      <label>Mobilnummer</label><input type="tel" name="phone" required autocomplete="tel" inputmode="tel" maxlength="32" value="${esc(S.user.phone || '')}">
      <button class="btn" type="submit">Gem mobilnummer</button>
    </form>
    <form id="pw" class="formcard" novalidate style="max-width:32rem">
      <h2 id="skift-adgangskode">Skift adgangskode</h2>
      <p class="muted" style="margin-top:0">Den nye adgangskode gælder med det samme og bevares, når serveren genstarter.</p>
      <label>Nuværende adgangskode</label><input type="password" name="current_password" required autocomplete="current-password">
      <label>Ny adgangskode</label><div class="muted" style="font-size:.8rem">Mindst ${minPw} tegn.</div><input type="password" name="new_password" required minlength="${minPw}" autocomplete="new-password">
      <button class="btn" type="submit">Gem ny adgangskode</button>
      <div id="pm"></div>
    </form>`;
  if (S.user.status === 'approved') shopShell('/account/profile', inner);
  else {
    $app.innerHTML = `<header class="shopbar">${brandLink()}<div class="sp"><span>${esc(S.user.email)}</span><button type="button" id="lo">Log Ud</button></div></header><main class="shopmain">${inner}</main>`;
    document.getElementById('lo').onclick = logout;
  }
  document.getElementById('pf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = new FormData(e.target).get('phone');
    if (String(phone || '').replace(/\D/g, '').length < 8) return showErr(sel('#msg'), new Error('Mobilnummer skal være 8-15 cifre'));
    try {
      const r = await api('PUT', '/api/shop/profile', { phone });
      S.user = r.user;
      sel('#msg').innerHTML = '<div class="ok">Mobilnummeret er gemt.</div>';
    } catch (err) { showErr(sel('#msg'), err); }
  });
  document.getElementById('pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (String(d.new_password || '').length < minPw) return showErr(document.getElementById('pm'), new Error(`Adgangskoden skal være mindst ${minPw} tegn`));
    try {
      await api('POST', '/api/auth/password', { current_password: d.current_password, new_password: d.new_password });
      e.target.reset();
      document.getElementById('pm').innerHTML = '<div class="ok">Adgangskoden er ændret.</div>';
    } catch (err) { showErr(document.getElementById('pm'), err); }
  });
  if (location.hash === '#skift-adgangskode') {
    const section = document.getElementById('skift-adgangskode');
    if (section) section.scrollIntoView();
  }
}

// ---------- router ----------
async function render() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  window.scrollTo(0, 0);
  try {
    if (S.user === null && !S.loaded) { S.user = (await api('GET', '/api/me')).user; S.loaded = true; }
    let m;
    if (path === '/') return landing();
    if (path === '/login' || path === '/register') { if (S.user) return go(isStaff(S.user) ? '/dashboard' : '/shop', true); return authPage(path.slice(1)); }
    if (!S.user) return go('/login', true);
    if (path === '/adgangskode' || path === '/account/adgangskode') return go(S.user.role === 'dealer' ? '/account/profile#skift-adgangskode' : '/account/password', true);
    if (path === '/account/password') return S.user.role === 'dealer' ? go('/account/profile#skift-adgangskode', true) : passwordPage();
    if (path === '/account/profile') return profilePage();
    if ((m = path.match(/^\/agreement\/(\d+)$/))) return agreementPage(m[1]);
    if (path.startsWith('/dashboard')) {
      if (!isStaff(S.user)) return go('/shop', true);
      if (path === '/dashboard') return dashboard();
      if (path === '/dashboard/vehicles') return vehiclesPage();
      if (path === '/dashboard/vehicles/new') return vehicleForm();
      if ((m = path.match(/^\/dashboard\/vehicles\/(\d+)\/edit$/))) return vehicleForm(m[1]);
      if ((m = path.match(/^\/dashboard\/packages\/(\d+)\/edit$/))) return packageEdit(m[1]);
      if (path === '/dashboard/packages') return packagesPage();
      if ((m = path.match(/^\/dashboard\/orders\/(\d+)\/edit$/))) return orderEdit(m[1]);
      if (path === '/dashboard/orders') return ordersPage();
      if ((m = path.match(/^\/dashboard\/dealers\/(\d+)\/edit$/))) return dealerEdit(m[1]);
      if (path === '/dashboard/dealers') return dealersPage();
      return go('/dashboard', true);
    }
    if (path.startsWith('/shop')) {
      if (isStaff(S.user)) return go('/dashboard', true);
      if (S.user.status !== 'approved') return holdPage();
      if (path === '/shop') return shopHome();
      if (path === '/shop/cart') return shopCart();
      if ((m = path.match(/^\/shop\/vehicles\/(\d+)$/))) return shopVehicle(m[1]);
      if (path === '/shop/packages') return shopPackages();
      if ((m = path.match(/^\/shop\/packages\/(\d+)$/))) return shopPackage(m[1]);
      if (path === '/shop/orders') return shopOrders();
      return go('/shop', true);
    }
    go('/', true);
  } catch (e) {
    if (e.status === 401) { S.user = null; return go('/login', true); }
    $app.innerHTML = `<div class="authwrap"><div class="authbox"><div class="err">${esc(e.message)}</div>${btnLink('/', 'Til forsiden')}</div></div>`;
  }
}
render();
