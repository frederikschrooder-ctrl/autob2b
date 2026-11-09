'use strict';
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
const L = {
  vstatus: { available: 'Tilgængelig', reserved: 'Reserveret', sold: 'Solgt', unavailable: 'Ikke tilgængelig' },
  ostatus: { pending: 'Afventende', confirmed: 'Bekræftet', completed: 'Gennemført', cancelled: 'Annulleret', expired: 'Udløbet' },
  dstatus: { pending: 'Afventende', approved: 'Aktiv', rejected: 'Afvist' },
  fuel: { el: 'El', hybrid: 'Hybrid', benzin: 'Benzin', diesel: 'Diesel' },
  gear: { automatic: 'Automatisk', manual: 'Manuel' },
  kind: { reserve: 'Reservation', buy: 'Køb' },
};
const pill = (map, k) => `<span class="pill ${esc(k)}">${esc(map[k] || k)}</span>`;

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
});
window.addEventListener('popstate', render);
const link = (href, text, cls = '') => `<a data-link href="${esc(href)}" class="${cls}">${text}</a>`;
function brandHome() {
  if (!S.user) return '/';
  return S.user.role === 'admin' ? '/dashboard' : '/shop';
}
function brandLink() {
  return `<a data-link class="brandlink" href="${esc(brandHome())}"><svg class="brandmark" viewBox="0 0 210 40" role="img" aria-label="Højbogård B2B"><title>Højbogård B2B</title><rect width="210" height="40" rx="8" fill="#5a5f66"/><path class="brand-car" d="M44 27c20-1 32-12 58-14 28-2 56 0 78 6 12 3 20 5 24 6" fill="none" stroke="#d5d8dc" stroke-width="1.15" stroke-linecap="round"/><rect x="6" y="5" width="30" height="30" rx="7" fill="none" stroke="#6abf4b" stroke-width="1.8"/><circle cx="21" cy="20" r="8" fill="#6abf4b"/><text x="21" y="24.2" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700">H</text><text x="42" y="26" fill="#6abf4b" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700">øjbogård B2B</text></svg></a>`;
}
const btnLink = (href, text, cls = '') => `<a data-link href="${esc(href)}" class="btn ${cls}">${text}</a>`;
const showErr = (el, e) => { el.innerHTML = `<div class="err">${esc(e.message || e)}</div>`; };
async function logout() { try { await api('POST', '/api/auth/logout', {}); } catch {} S.user = null; go('/login'); }

// ---------- landing ----------
function landing() {
  $app.innerHTML = `
  <div class="topbar">${brandLink()}<div>${S.user ? btnLink(S.user.role === 'admin' ? '/dashboard' : '/shop', 'Til platformen') : btnLink('/login', 'Log ind', 'outline')}</div></div>
  <section class="hero">
    <div class="badge">Lukket B2B Platform — Kun for Forhandlere</div>
    <h1>Premium Importerede Biler Fra Tyskland til Danmark</h1>
    <p>Køb kvalitetsbiler direkte til engrospriser – enkeltvis eller i partier. Adgang kræver en godkendt forhandlerkonto.</p>
    <div class="row">${btnLink('/register', 'Ansøg om Forhandlerkonto', 'big')}${btnLink('/login', 'Log Ind', 'big outline')}</div>
  </section>
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
  <section class="cta"><h2>Klar til at komme i gang?</h2>${btnLink('/register', 'Ansøg om Forhandlerkonto', 'big')}</section>
  <div class="footer">© Højbogård B2B – Lukket B2B platform for bilforhandlere</div>`;
}

// ---------- auth ----------
function authPage(kind) {
  const isLogin = kind === 'login';
  $app.innerHTML = `<div class="authwrap"><form class="authbox" id="f" novalidate>
    ${brandLink()}
    <h1>${isLogin ? 'Log ind' : 'Ansøg om Forhandlerkonto'}</h1>
    <p class="muted">${isLogin ? 'Administratorer og forhandlere bruger samme login.' : 'Udfyld oplysningerne – vi godkender din ansøgning manuelt.'}</p>
    <div id="msg"></div>
    ${isLogin ? '' : `<label>Firmanavn</label><input name="company_name" required autocomplete="organization">
      <div class="grid2"><div><label>CVR-nummer</label><input name="cvr" required inputmode="numeric" maxlength="10"></div><div><label>By</label><input name="city" required autocomplete="address-level2"></div></div>`}
    <label>E-mail</label><input type="email" name="email" required autocomplete="email">
    <label>Adgangskode</label><input type="password" name="password" required autocomplete="${isLogin ? 'current-password' : 'new-password'}" ${isLogin ? '' : 'minlength="10"'}>
    ${isLogin ? '' : '<div class="muted" style="font-size:.8rem">Mindst 10 tegn.</div>'}
    <button class="btn" type="submit">${isLogin ? 'Log Ind' : 'Send Ansøgning'}</button>
    <div class="links">${isLogin ? link('/register', 'Ansøg om forhandlerkonto') : link('/login', 'Har du allerede en konto? Log ind')}${link('/', '← Tilbage')}</div>
  </form></div>`;
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const msg = document.getElementById('msg'); const btn = f.querySelector('button');
    const d = Object.fromEntries(new FormData(f)); btn.disabled = true;
    try {
      if (!isLogin && String(d.password || '').length < 10) throw new Error('Adgangskoden skal være mindst 10 tegn');
      if (isLogin) {
        const r = await api('POST', '/api/auth/login', d); S.user = r.user;
        go(r.user.role === 'admin' ? '/dashboard' : '/shop');
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
  $app.innerHTML = `<div class="layout"><aside class="side" id="side"><div class="sidehead">${brandLink()}<button type="button" class="navtoggle" id="navtoggle" aria-expanded="false" aria-controls="sidenav">Menu</button></div>
    <nav id="sidenav" aria-label="Administration">${nav.map(([h, t]) => `<a data-link href="${esc(h)}" class="${h === active ? 'active' : ''}" ${h === active ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    <div class="user"><div class="n">${esc(S.user.name)}</div><div class="e">${esc(S.user.email)}</div><button type="button" id="lo">Log Ud</button></div></aside>
    <main class="main">${inner}</main></div>`;
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
    <select id="st"><option value="">Alle statusser</option>${Object.entries({ available: 'Tilgængelig', reserved: 'Reserveret', sold: 'Solgt' }).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <select id="fu"><option value="">Alle brændstoftyper</option>${Object.entries(L.fuel).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div id="msg"></div><div id="tbl"></div>`);
  const load = async () => {
    if (!sel('#q')) return;
    const p = new URLSearchParams(); if (sel('#q').value) p.set('q', sel('#q').value); if (sel('#st').value) p.set('status', sel('#st').value); if (sel('#fu').value) p.set('fuel', sel('#fu').value);
    try {
      const r = await api('GET', '/api/admin/vehicles?' + p);
      sel('#cnt').textContent = `${r.count} ${r.count === 1 ? 'bil' : 'biler'}`;
      sel('#tbl').innerHTML = r.vehicles.length ? `<div class="tablewrap"><table><thead><tr><th></th><th>VIN</th><th>Mærke / Model</th><th>Variant</th><th>Km</th><th>Brændstof</th><th>Engrospris</th><th>Status</th><th>Handlinger</th></tr></thead><tbody>
      ${r.vehicles.map((v) => `<tr>${cell('Billede', v.images[0] ? `<img class="thumb" src="${esc(v.images[0])}" alt="">` : '<div class="thumb"></div>')}${cell('VIN', esc(v.vin))}${cell('Mærke / Model', `<b>${esc(v.make)}</b> ${esc(v.model)}`)}${cell('Variant', esc(v.variant || '—'))}${cell('Km', v.mileage != null ? num(v.mileage) : '—')}${cell('Brændstof', esc(L.fuel[v.fuel] || '—'))}${cell('Engrospris', dkk(v.price))}${cell('Status', pill(L.vstatus, v.status))}
      ${cell('Handlinger', `${btnLink('/dashboard/vehicles/' + v.id + '/edit', 'Rediger', 'small outline')}<button type="button" class="btn small danger" data-del="${v.id}" data-name="${esc(v.make + ' ' + v.model + ' (' + v.vin + ')')}" aria-label="Slet ${esc(v.make + ' ' + v.model)}">Slet</button>`, 'act')}</tr>`).join('')}</tbody></table></div>` : '<div class="tablewrap"><div class="empty">Ingen biler fundet.</div></div>';
    } catch (e) { showErr(sel('#msg'), e); }
  };
  sel('#q').addEventListener('input', debounce(load)); sel('#st').onchange = load; sel('#fu').onchange = load;
  sel('#tbl').addEventListener('click', async (e) => {
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
   <div class="formcard"><h2>Billeder</h2><input type="file" id="files" multiple accept=".jpg,.jpeg,.png,.heic,.webp,image/jpeg,image/png,image/webp,image/heic"><div class="muted" style="font-size:.8rem;margin-top:.3rem">JPG, PNG, HEIC eller WebP. Du kan vælge flere filer.</div><div class="previews" id="pv"></div></div>
   <div class="formcard"><h2>Dokumenter</h2><label>Tilstandsrapport (URL)</label><input type="url" name="condition_report_url" placeholder="https://…" value="${esc(v.condition_report_url || '')}"></div>
   <button class="btn" type="submit">Gem Bil</button> ${btnLink('/dashboard/vehicles', 'Annuller', 'outline')}
  </form>`);
  const drawPv = () => {
    sel('#pv').innerHTML = images.map((u, i) => `<div class="pv">${u.endsWith('.heic') ? `<div class="heic">HEIC</div>` : `<img src="${esc(u)}" alt="">`}<button type="button" data-rm="${i}" title="Fjern">×</button></div>`).join('');
  };
  drawPv();
  sel('#pv').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { images.splice(+b.dataset.rm, 1); drawPv(); } });
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
  const [pk, vs] = await Promise.all([api('GET', '/api/admin/packages'), api('GET', '/api/admin/vehicles')]);
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
    ${p.status === 'available' ? btnLink('/dashboard/packages/' + p.id + '/edit', 'Rediger', 'small outline') : ''}<button type="button" class="btn small danger" data-del="${p.id}" data-name="${esc(p.name)}">Slet Parti</button></div>`).join('')}</div>` : '<div class="tablewrap"><div class="empty">Ingen partier endnu.</div></div>'}`);

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
    if (!confirm(`Slet partiet "${b.dataset.name}"? Bilerne i partiet bliver ikke slettet.`)) return;
    try { await api('DELETE', '/api/admin/packages/' + b.dataset.del); packagesPage(); } catch (err) { showErr(sel('#msg'), err); }
  }));
}

// ---------- admin: orders ----------
function confirmArchive(id) {
  return confirm(`Arkivér ordre #${id}?\n\nOrdren fjernes fra oversigten og tællingerne. Købsaftalen og prisen i aftalen slettes ikke.\n\nEn afventende reservation frigives.\nEn bekræftet eller gennemført handel sætter ikke bilen til salg igen.\n\nDu kan gendanne ordren under Arkiv.`);
}
function recentOrders(orders) {
  if (!orders.length) return '<div class="tablewrap"><div class="empty">Ingen ordrer.</div></div>';
  return `<div class="recent-orders">${orders.map((o) => `<article class="recent-order">
    <div class="recent-main"><b>#${o.id}</b> ${esc(o.item_label)}<div class="muted">${esc(o.dealer?.company_name || '—')} · ${esc(L.kind[o.kind] || o.kind)} · ${dkk(o.price)} · ${dt(o.created_at)}</div></div>
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
    if (archived) return edit + `<button type="button" class="btn small" data-restore="${o.id}" aria-label="Gendan ordre ${o.id}">Gendan</button>`;
    const status = full ? `${o.status === 'pending' ? `<button type="button" class="btn small" data-act="confirm" data-id="${o.id}">Bekræft</button>` : ''}${o.status === 'confirmed' ? `<button type="button" class="btn small" data-act="complete" data-id="${o.id}">Gennemfør</button>` : ''}${['pending', 'confirmed'].includes(o.status) ? `<button type="button" class="btn small danger" data-act="cancel" data-id="${o.id}" aria-label="Annuller ordre ${o.id}">Annuller</button>` : ''}${o.has_agreement ? btnLink('/agreement/' + o.id, 'Aftale', 'small outline') : ''}` : '';
    return status + edit + `<button type="button" class="btn small danger" data-archive="${o.id}" aria-label="Arkivér ordre ${o.id}">Slet</button>`;
  };
  return `<div class="tablewrap"><table><thead><tr><th>#</th><th>Forhandler</th><th>Vare</th><th>Type</th><th>Pris (ekskl. moms)</th><th>Status</th><th>Oprettet</th><th>Udløber</th>${actions ? '<th>Handlinger</th>' : ''}</tr></thead><tbody>
  ${orders.map((o) => `<tr>${cell('#', o.id)}${cell('Forhandler', esc(o.dealer?.company_name || '—'))}${cell('Vare', esc(o.item_label))}${cell('Type', L.kind[o.kind])}${cell('Pris (ekskl. moms)', dkk(o.price))}${cell('Status', pill(L.ostatus, o.status))}${cell('Oprettet', dt(o.created_at))}${cell('Udløber', o.status === 'pending' && !o.archived_at ? dt(o.expires_at) : '—')}
  ${actions ? cell('Handlinger', buttons(o), 'act') : ''}</tr>`).join('')}</tbody></table></div>`;
}
async function ordersPage() {
  adminShell('/dashboard/orders', `<div class="pagehead"><h1>Ordrer</h1></div><div class="filters"><select id="st"><option value="">Alle aktive ordrer</option>${Object.entries(L.ostatus).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}<option value="archived">Arkiv</option></select></div><p class="muted">Slet arkiverer ordren. Købsaftalen bliver liggende, og en solgt bil sættes ikke til salg igen.</p><div id="msg"></div><div id="tbl"></div>`);
  const load = async () => {
    try {
      const st = sel('#st').value;
      const q = st === 'archived' ? '?archived=1' : (st ? '?status=' + st : '');
      const r = await api('GET', '/api/admin/orders' + q);
      sel('#tbl').innerHTML = ordersTable(r.orders, st === 'archived' ? 'archived' : 'full');
    } catch (e) { showErr(sel('#msg'), e); }
  };
  sel('#st').onchange = load;
  sel('#tbl').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    const archive = e.target.closest('[data-archive]');
    const restore = e.target.closest('[data-restore]');
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
      <p>Forhandler: <b>${esc(o.dealer?.company_name || '—')}</b> · ${esc(L.kind[o.kind])} · ${pill(L.ostatus, o.status)}${locked ? ' · Arkiveret' : ''}</p>
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
    <p>${locked ? `<button type="button" class="btn" id="restore">Gendan</button>` : `<button type="button" class="btn danger" id="archive">Slet</button>`}</p>`);
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
}

// ---------- admin: dealers ----------
async function dealersPage() {
  adminShell('/dashboard/dealers', '<h1>Indlæser…</h1>');
  const { dealers } = await api('GET', '/api/admin/dealers');
  const sect = (title, st, rows, acts) => `<h2>${title} (${rows.length})</h2>${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Firma</th><th>CVR</th><th>By</th><th>E-mail</th><th>Ansøgt</th><th>Status</th><th>Handlinger</th></tr></thead><tbody>${rows.map((d) => `<tr>${cell('Firma', `<b>${esc(d.company_name)}</b>`)}${cell('CVR', esc(d.cvr))}${cell('By', esc(d.city))}${cell('E-mail', esc(d.email))}${cell('Ansøgt', dt(d.created_at))}${cell('Status', pill(L.dstatus, d.status))}${cell('Handlinger', acts(d), 'act')}</tr>`).join('')}</tbody></table></div>` : `<div class="tablewrap"><div class="empty">Ingen.</div></div>`}<br>`;
  const by = (s) => dealers.filter((d) => d.status === s);
  adminShell('/dashboard/dealers', `<div class="pagehead"><h1>Forhandlerstyring</h1></div><div id="msg"></div>
    ${sect('Afventende Ansøgninger', 'pending', by('pending'), (d) => `${btnLink('/dashboard/dealers/' + d.id + '/edit', 'Rediger', 'small outline')}<button type="button" class="btn small" data-a="approve" data-id="${d.id}" aria-label="Godkend ${esc(d.company_name)}">Godkend</button><button type="button" class="btn small danger" data-a="reject" data-id="${d.id}" aria-label="Afvis ${esc(d.company_name)}">Afvis</button>`)}
    ${sect('Godkendte Forhandlere', 'approved', by('approved'), (d) => `${btnLink('/dashboard/dealers/' + d.id + '/edit', 'Rediger', 'small outline')}<button type="button" class="btn small danger" data-a="reject" data-id="${d.id}" aria-label="Afvis ${esc(d.company_name)}">Afvis</button>`)}
    ${sect('Afviste', 'rejected', by('rejected'), (d) => `${btnLink('/dashboard/dealers/' + d.id + '/edit', 'Rediger', 'small outline')}<button type="button" class="btn small outline" data-a="approve" data-id="${d.id}" aria-label="Godkend ${esc(d.company_name)}">Godkend</button>`)}
    <form id="af" class="formcard" novalidate><h2>Tilføj Administrator</h2><p class="muted" style="margin-top:0">Kun administratorer kan oprette nye administratorer.</p>
      <div class="grid2"><div><label>Navn</label><input name="name" required></div><div><label>E-mail</label><input type="email" name="email" required></div><div><label>Adgangskode (min. 4 tegn)</label><input type="password" name="password" minlength="4" required autocomplete="new-password"></div></div>
      <button class="btn" style="margin-top:1rem">Opret Administrator</button><div id="am"></div></form>`);
  document.querySelector('.main').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    try { await api('POST', `/api/admin/dealers/${b.dataset.id}/${b.dataset.a}`, {}); dealersPage(); } catch (err) { showErr(sel('#msg'), err); }
  });
  sel('#af').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(e.target));
    if (String(fields.password || '').length < 4) return showErr(sel('#am'), new Error('Adgangskoden skal være mindst 4 tegn'));
    try { const r = await api('POST', '/api/admin/admins', fields); e.target.reset(); sel('#am').innerHTML = `<div class="ok">Administrator ${esc(r.admin.email)} er oprettet.</div>`; } catch (err) { showErr(sel('#am'), err); }
  });
}

// ---------- dealer shop ----------
function shopShell(active, inner, unread = 0) {
  const nav = [['/shop', 'Biler'], ['/shop/packages', 'Partier'], ['/shop/orders', 'Mine ordrer']];
  $app.innerHTML = `<header class="shopbar">${brandLink()}<nav aria-label="Forhandler">${nav.map(([h, t]) => `<a data-link href="${esc(h)}" class="${h === active ? 'active' : ''}" ${h === active ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
   <div class="sp"><span>${esc(S.user.company_name || S.user.name)}</span>${link('/account/password', 'Adgangskode')}<button type="button" id="lo">Log Ud</button></div></header><main class="shopmain">${inner}</main>`;
  document.getElementById('lo').onclick = logout;
}
function holdPage() {
  const rej = S.user.status === 'rejected';
  $app.innerHTML = `<header class="shopbar">${brandLink()}<div class="sp"><span>${esc(S.user.email)}</span><button type="button" id="lo">Log Ud</button></div></header>
  <main class="shopmain"><div class="authbox" style="margin:3rem auto"><h1>${rej ? 'Din ansøgning er afvist' : 'Din ansøgning afventer godkendelse'}</h1>
  <p>${rej ? 'Din forhandlerkonto er desværre ikke blevet godkendt, og du har derfor ikke adgang til kataloget.' : 'Vi gennemgår din ansøgning. Du får adgang til biler og partier, så snart din konto er godkendt.'}</p>
  ${rej ? '' : '<p class="muted">Opdater siden for at se, om kontoen er blevet godkendt.</p>'}
  <p>${btnLink('/account/password', 'Skift adgangskode', 'outline')}</p></div></main>`;
  document.getElementById('lo').onclick = logout;
}
const carImg = (v) => (v.images && v.images[0] && !v.images[0].endsWith('.heic') ? `<img src="${esc(v.images[0])}" alt="">` : '🚗');
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
      const r = await api('GET', '/api/shop/vehicles?' + p);
      sel('#lst').innerHTML = r.vehicles.length ? `<div class="vgrid">${r.vehicles.map((v) => `<div class="vcard"><div class="img">${carImg(v)}</div><div class="bd"><h3>${esc(v.make)} ${esc(v.model)}</h3><div class="muted">${esc(v.variant || '')}</div><div class="muted" style="font-size:.85rem">${[v.first_registration ? v.first_registration.slice(0, 4) : '', v.mileage != null ? num(v.mileage) + ' km' : '', L.fuel[v.fuel] || ''].filter(Boolean).join(' · ')}</div><div class="price" style="margin:.6rem 0">${dkk(v.price)} <small>ekskl. moms</small></div>${btnLink('/shop/vehicles/' + v.id, 'Se detaljer', 'small')}</div></div>`).join('')}</div>` : '<div class="empty">Der er ingen tilgængelige biler lige nu.</div>';
    } catch (e) { showErr(sel('#msg'), e); }
  };
  sel('#q').addEventListener('input', debounce(load)); sel('#fu').onchange = load; load();
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
  const wrapper = (inner) => (S.user.role === 'admin' ? adminShell('/dashboard/orders', inner) : shopShell('/shop/orders', inner));
  wrapper('<p>Indlæser…</p>');
  let o; try { o = (await api('GET', '/api/orders/' + id)).order; } catch (e) { return wrapper(`<div class="err">${esc(e.message)}</div>`); }
  const a = o.agreement; if (!a) return wrapper('<div class="notice">Denne ordre har endnu ingen købsaftale (kun reservation).</div>');
  wrapper(`<p class="noprint">${link(S.user.role === 'admin' ? '/dashboard/orders' : '/shop/orders', '← Tilbage til ordrer')} · <a href="#" id="pr">Print</a></p>
  <div class="agreement"><h1>Købsaftale</h1><p class="muted">Aftalenr. <b>${esc(a.number)}</b> · ${dt(a.date)}</p>
  <h3>Sælger</h3><p>${sellerBlock(a.seller)}</p>
  <h3>Køber</h3><p>${esc(a.buyer.company)}<br>CVR: ${esc(a.buyer.cvr)} · ${esc(a.buyer.city)}<br>Kontakt: ${esc(a.buyer.contact)} (${esc(a.buyer.email)})</p>
  <h3>Genstand: ${esc(a.subject)}</h3><div class="tablewrap"><table><thead><tr><th>Køretøj</th><th>VIN</th><th style="text-align:right">${a.package_breakdown ? 'Katalogpris' : 'Pris'}</th></tr></thead><tbody>${a.items.map((i) => `<tr>${cell('Køretøj', esc(i.description))}${cell('VIN', esc(i.vin))}${cell(a.package_breakdown ? 'Katalogpris' : 'Pris', i.price ? dkk(i.price) : '')}</tr>`).join('')}</tbody></table></div>
  <table class="spec" style="margin-top:1rem">${a.package_breakdown ? `<tr><td>Sum af katalogpriser</td><td style="text-align:right">${dkk(a.package_breakdown.catalog_sum)}</td></tr><tr><td>${a.package_breakdown.adjustment < 0 ? 'Prisjustering (rabat)' : a.package_breakdown.adjustment > 0 ? 'Prisjustering (tillæg)' : 'Prisjustering'}</td><td style="text-align:right">${dkk(a.package_breakdown.adjustment)}</td></tr><tr><td>Aftalt pakkepris ekskl. moms</td><td style="text-align:right">${dkk(a.price_excl_vat)}</td></tr>` : `<tr><td>Pris ekskl. moms</td><td style="text-align:right">${dkk(a.price_excl_vat)}</td></tr>`}<tr><td>Moms (${a.vat_rate * 100}%)</td><td style="text-align:right">${dkk(a.vat)}</td></tr><tr><td><b>I alt inkl. moms</b></td><td style="text-align:right"><b>${dkk(a.total_incl_vat)}</b></td></tr></table>
  <h3 style="margin-top:1.5rem">Vilkår</h3><ol>${a.terms.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>`);
  sel('#pr').onclick = (e) => { e.preventDefault(); window.print(); };
}

// ---------- password ----------
function passwordPage() {
  const minPw = Number(S.user.password_min_length) || (S.user.role === 'admin' ? 4 : 10);
  const inner = `<div class="pagehead"><h1>Skift adgangskode</h1></div>
    <form id="pf" class="formcard" novalidate style="max-width:32rem">
      <p class="muted" style="margin-top:0">Den nye adgangskode gælder med det samme og bevares, når serveren genstarter.</p>
      <label>Nuværende adgangskode</label><input type="password" name="current_password" required autocomplete="current-password">
      <label>Ny adgangskode (min. ${minPw} tegn)</label><input type="password" name="new_password" required minlength="${minPw}" autocomplete="new-password">
      <button class="btn" type="submit">Gem ny adgangskode</button>
      <div id="pm"></div>
    </form>`;
  if (S.user.role === 'admin') adminShell('/account/password', inner);
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

// ---------- router ----------
async function render() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  window.scrollTo(0, 0);
  try {
    if (S.user === null && !S.loaded) { S.user = (await api('GET', '/api/me')).user; S.loaded = true; }
    let m;
    if (path === '/') return landing();
    if (path === '/login' || path === '/register') { if (S.user) return go(S.user.role === 'admin' ? '/dashboard' : '/shop', true); return authPage(path.slice(1)); }
    if (!S.user) return go('/login', true);
    if (path === '/account/password') return passwordPage();
    if ((m = path.match(/^\/agreement\/(\d+)$/))) return agreementPage(m[1]);
    if (path.startsWith('/dashboard')) {
      if (S.user.role !== 'admin') return go('/shop', true);
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
      if (S.user.role === 'admin') return go('/dashboard', true);
      if (S.user.status !== 'approved') return holdPage();
      if (path === '/shop') return shopHome();
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
