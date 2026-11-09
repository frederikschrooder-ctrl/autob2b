'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const { openDb } = require('./db');
const A = require('./auth');
const { bootstrapAdmin } = require('./bootstrap-admin');
const { resolveTrustProxy } = require('./runtime-config');
const { minLengthForRole, passwordPolicyError } = require('./password-policy');
const { parseSellerIdentity, BUY_CLOSED } = require('./seller-identity');

const FUELS = ['el', 'hybrid', 'benzin', 'diesel'];
const TRANSMISSIONS = ['automatic', 'manual'];
const VEHICLE_STATUSES = ['available', 'reserved', 'sold'];
const ORDER_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'expired'];
const RESERVE_MS = 24 * 3600 * 1000;
const VAT_RATE = 0.25;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);

const str = (v, { max = 200, required = false, field = 'felt' } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${field} er påkrævet`); return null; }
  if (typeof v !== 'string') throw bad(`${field} er ugyldig`);
  const s = v.trim();
  if (!s) { if (required) throw bad(`${field} er påkrævet`); return null; }
  if (s.length > max) throw bad(`${field} er for lang`);
  return s;
};
const int = (v, { min = 0, max = 1e10, required = false, field = 'felt' } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${field} er påkrævet`); return null; }
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n) || !Number.isInteger(Math.round(n)) || n < min || n > max) throw bad(`${field} er ugyldig`);
  return Math.round(n);
};
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const checkEmail = (v) => { const e = str(v, { max: 254, required: true, field: 'E-mail' }).toLowerCase(); if (!EMAIL_RE.test(e)) throw bad('E-mail er ugyldig'); return e; };
const checkPassword = (v, role) => {
  const err = passwordPolicyError(v, { min: minLengthForRole(role) });
  if (err) throw bad(err);
  return v;
};
const likeEsc = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(4, 8).toString() === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)/.test(buf.slice(8, 12).toString())) return 'heic';
  return null;
}

function createApp(opts = {}) {
  const dbFile = opts.dbFile || path.join(__dirname, '..', 'data', 'autob2b.sqlite');
  const uploadDir = opts.uploadDir || path.join(__dirname, '..', 'uploads');
  const now = opts.now || (() => Date.now());
  const db = openDb(dbFile);
  const log = opts.logger?.log || (opts.bootstrapLog ? (...a) => console.log(...a) : () => {});
  const error = opts.logger?.error || (opts.bootstrapLog ? (...a) => console.error(...a) : () => {});
  const bootstrap = bootstrapAdmin(db, opts.env || {}, { log, error });
  const sellerIdentity = parseSellerIdentity(opts.env || {});
  if (!sellerIdentity.ok) log('Seller identity is incomplete or invalid. New purchase agreements are closed until SELLER_LEGAL_NAME, SELLER_CVR, and SELLER_ADDRESS are valid. Reservations are unchanged.');
  fs.mkdirSync(uploadDir, { recursive: true });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', resolveTrustProxy(opts.trustProxy));
  const cookieBase = () => ({ httpOnly: true, sameSite: 'lax', secure: !!opts.cookieSecure, path: '/' });

  // ---------- helpers on data ----------
  const imageRows = (vehicleId) => db.prepare('SELECT id, url, position FROM vehicle_images WHERE vehicle_id=? ORDER BY position, id').all(vehicleId);
  const vehicleOut = (v) => {
    if (!v) return v;
    const rows = imageRows(v.id);
    const images = rows.length ? rows.map((r) => r.url) : (() => { try { const p = JSON.parse(v.images || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } })();
    return { ...v, images };
  };
  const withImageIds = (v) => v && ({ ...v, image_ids: imageRows(v.id).map((r) => r.id) });
  function syncVehicleImages(vehicleId, urls) {
    const existing = db.prepare('SELECT id, url FROM vehicle_images WHERE vehicle_id=? ORDER BY position, id').all(vehicleId);
    const pools = new Map();
    for (const row of existing) {
      if (!pools.has(row.url)) pools.set(row.url, []);
      pools.get(row.url).push(row.id);
    }
    const keep = [];
    urls.forEach((url, index) => {
      const pool = pools.get(url);
      const existingId = pool && pool.length ? pool.shift() : null;
      if (existingId) {
        db.prepare('UPDATE vehicle_images SET position=? WHERE id=?').run(index + 1, existingId);
        keep.push(existingId);
      } else {
        keep.push(Number(db.prepare('INSERT INTO vehicle_images (vehicle_id, url, position) VALUES (?,?,?)').run(vehicleId, url, index + 1).lastInsertRowid));
      }
    });
    const kept = new Set(keep);
    for (const row of existing) if (!kept.has(row.id)) db.prepare('DELETE FROM vehicle_images WHERE id=?').run(row.id);
  }
  const vehicleLabel = (v) => [v.make, v.model, v.variant].filter(Boolean).join(' ');
  const getVehicle = (id) => vehicleOut(db.prepare('SELECT * FROM vehicles WHERE id=?').get(id));
  const pkgCars = (id) => db.prepare('SELECT v.* FROM package_vehicles pv JOIN vehicles v ON v.id=pv.vehicle_id WHERE pv.package_id=? ORDER BY v.id').all(id).map(vehicleOut);
  const pkgOut = (p) => {
    if (!p) return null;
    const cars = pkgCars(p.id);
    let effective = p.status;
    if (cars.length === 0 || (p.status === 'available' && cars.some((c) => c.status !== 'available' || saleLocked(c.id)))) effective = 'unavailable';
    return { ...p, vehicles: cars, vehicle_count: cars.length, effective_status: effective };
  };
  const orderVehicles = (orderId) => db.prepare('SELECT vehicle_id FROM order_vehicles WHERE order_id=?').all(orderId).map((r) => r.vehicle_id);
  const LOCK_SQL = `(o.status IN ('confirmed','completed') OR (o.status='pending' AND o.archived_at IS NULL))`;
  function lockingOrder(vehicleId, exceptOrderId = 0) {
    return db.prepare(`SELECT o.* FROM order_vehicles ov JOIN orders o ON o.id=ov.order_id WHERE ov.vehicle_id=? AND o.id<>? AND ${LOCK_SQL} LIMIT 1`).get(vehicleId, exceptOrderId);
  }
  function saleLocked(vehicleId, exceptOrderId = 0) {
    return !!db.prepare(`SELECT 1 FROM order_vehicles ov JOIN orders o ON o.id=ov.order_id WHERE ov.vehicle_id=? AND o.id<>? AND o.status IN ('confirmed','completed') LIMIT 1`).get(vehicleId, exceptOrderId);
  }

  function releaseOrder(order) {
    const upd = db.prepare(`UPDATE vehicles SET status='available' WHERE id=?`);
    for (const vid of orderVehicles(order.id)) {
      if (lockingOrder(vid, order.id)) continue;
      upd.run(vid);
    }
    if (order.package_id) {
      const still = orderVehicles(order.id).some((vid) => lockingOrder(vid, order.id));
      const other = db.prepare(`SELECT 1 FROM orders o WHERE o.package_id=? AND o.id<>? AND ${LOCK_SQL}`).get(order.package_id, order.id);
      if (!still && !other) db.prepare(`UPDATE packages SET status='available' WHERE id=?`).run(order.package_id);
    }
  }
  function setOrderItemsStatus(order, status) {
    const upd = db.prepare('UPDATE vehicles SET status=? WHERE id=?');
    orderVehicles(order.id).forEach((vid) => upd.run(status, vid));
    if (order.package_id) db.prepare('UPDATE packages SET status=? WHERE id=?').run(status, order.package_id);
  }
  function isBusy(e) {
    const msg = String(e && (e.message || e.code || ''));
    return (e && (e.code === 'ERR_SQLITE_ERROR' || e.code === 'SQLITE_BUSY')) && /locked|SQLITE_BUSY|busy/i.test(msg);
  }
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      if (isBusy(e)) throw new HttpError(409, 'Handlingen kunne ikke gennemføres, fordi varen blev opdateret samtidig. Prøv igen.');
      throw e;
    }
  }
  function expireOrders(nowMs = now()) {
    const iso = new Date(nowMs).toISOString();
    return tx(() => {
      const due = db.prepare(`SELECT * FROM orders WHERE kind='reserve' AND status='pending' AND archived_at IS NULL AND expires_at IS NOT NULL AND expires_at<=?`).all(iso);
      for (const o of due) { db.prepare(`UPDATE orders SET status='expired' WHERE id=?`).run(o.id); releaseOrder(o); }
      db.prepare('DELETE FROM sessions WHERE expires_at<?').run(nowMs);
      return due.length;
    });
  }

  function requireSeller() {
    if (!sellerIdentity.ok) throw new HttpError(503, BUY_CLOSED);
    return sellerIdentity.seller;
  }

  function buildAgreement(order, dealer, items) {
    const seller = requireSeller();
    const catalog_sum = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
    const agreed = order.price;
    const vat = Math.round(agreed * VAT_RATE);
    const d = new Date(now());
    const agreement = {
      number: `AG-${d.getUTCFullYear()}-${String(order.id).padStart(5, '0')}`,
      date: d.toISOString(),
      seller: { name: seller.name, cvr: seller.cvr, address: seller.address },
      buyer: { company: dealer.company_name, cvr: dealer.cvr, city: dealer.city, contact: dealer.name, email: dealer.email },
      subject: order.item_label,
      items: items.map((i) => ({ vin: i.vin, description: vehicleLabel(i), price: i.price })),
      price_excl_vat: agreed,
      vat_rate: VAT_RATE,
      vat,
      total_incl_vat: agreed + vat,
      terms: [
        'Priserne er engrospriser ekskl. moms. Moms tillægges efter gældende regler.',
        'Køber bekræfter at være en professionel, godkendt forhandler registreret med det angivne CVR-nummer.',
        'Køretøjerne sælges som beskrevet i annoncen og tilstandsrapporten. Sælger er ikke ansvarlig for forhold, der fremgår af rapporten.',
        'Betaling sker efter faktura fra ' + seller.name + '. Levering aftales efter modtaget betaling.',
        'Aftalen er bindende fra det tidspunkt, den er genereret i systemet.',
      ],
    };
    if (order.package_id) {
      agreement.package_breakdown = {
        catalog_sum,
        adjustment: agreed - catalog_sum,
        agreed_price: agreed,
      };
    }
    return agreement;
  }

  function createOrder({ dealer, kind, vehicle, pkg }) {
    if (kind === 'buy') requireSeller();
    const isPkg = !!pkg;
    const cars = isPkg ? pkgCars(pkg.id) : [vehicle];
    if (isPkg && cars.length === 0) throw new HttpError(409, 'Partiet indeholder ingen biler');
    for (const c of cars) {
      if (lockingOrder(c.id)) throw new HttpError(409, 'Bilen er ikke længere tilgængelig');
    }
    const price = isPkg ? pkg.total_price : vehicle.price;
    const label = isPkg ? `Parti: ${pkg.name}` : vehicleLabel(vehicle);
    const expires = kind === 'reserve' ? new Date(now() + RESERVE_MS).toISOString() : null;
    const status = kind === 'reserve' ? 'pending' : 'confirmed';
    const r = db.prepare(`INSERT INTO orders (dealer_id,vehicle_id,package_id,kind,status,price,item_label,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(dealer.id, isPkg ? null : vehicle.id, isPkg ? pkg.id : null, kind, status, price, label, expires, new Date(now()).toISOString());
    const id = Number(r.lastInsertRowid);
    cars.forEach((c) => db.prepare('INSERT INTO order_vehicles (order_id,vehicle_id) VALUES (?,?)').run(id, c.id));
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    if (kind === 'buy') db.prepare('UPDATE orders SET agreement=? WHERE id=?').run(JSON.stringify(buildAgreement(order, dealer, cars)), id);
    const newStatus = kind === 'buy' ? 'sold' : 'reserved';
    const claim = db.prepare(`UPDATE vehicles SET status=? WHERE id=? AND status='available'`);
    for (const c of cars) {
      if (claim.run(newStatus, c.id).changes !== 1) throw new HttpError(409, 'Bilen er ikke længere tilgængelig');
    }
    if (isPkg) {
      const pr = db.prepare(`UPDATE packages SET status=? WHERE id=? AND status='available'`).run(newStatus, pkg.id);
      if (pr.changes !== 1) throw new HttpError(409, 'Partiet er ikke længere tilgængeligt');
    }
    return id;
  }

  const orderOut = (o, { withDealer = false, withAgreement = false } = {}) => {
    if (!o) return null;
    const out = { ...o, agreement: undefined, has_agreement: !!o.agreement };
    if (withAgreement && o.agreement) out.agreement = JSON.parse(o.agreement);
    if (!withDealer) {
      delete out.admin_note;
      delete out.archive_note;
      delete out.archived_by;
    } else {
      out.corrections = db.prepare('SELECT id, previous_price, new_price, reason, admin_id, created_at FROM order_corrections WHERE order_id=? ORDER BY id').all(o.id);
    }
    out.vehicles = orderVehicles(o.id).map((vid) => db.prepare('SELECT id,vin,make,model,variant FROM vehicles WHERE id=?').get(vid)).filter(Boolean);
    if (withDealer) {
      const d = db.prepare('SELECT id,name,email,company_name,cvr,city FROM users WHERE id=?').get(o.dealer_id);
      out.dealer = d;
    }
    return out;
  };

  // ---------- middleware ----------
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-requested-with') !== 'autob2b') return res.status(403).json({ error: 'Ugyldig anmodning' });
    next();
  });
  app.use('/api', (req, res, next) => (req.path === '/admin/uploads' ? next() : express.json({ limit: '200kb' })(req, res, next)));
  app.use('/api', (req, res, next) => {
    const token = A.parseCookies(req.headers.cookie).sid;
    req.sessionToken = token;
    req.user = A.userFromToken(db, token);
    if (req.method === 'GET' || !req.path.startsWith('/')) { /* no-op */ }
    next();
  });
  const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Du skal være logget ind' }));
  const requireAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Du skal være logget ind' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Kun for administratorer' });
    next();
  };
  const requireDealer = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Du skal være logget ind' });
    if (req.user.role !== 'dealer') return res.status(403).json({ error: 'Kun for forhandlere' });
    if (req.user.status !== 'approved') return res.status(403).json({ error: 'Din forhandlerkonto er ikke godkendt' });
    next();
  };
  const wrap = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };
  const idParam = (req) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Ikke fundet'); return n; };

  const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, company_name: u.company_name, cvr: u.cvr, city: u.city, password_min_length: minLengthForRole(u.role) });

  // ---------- auth ----------
  const attempts = new Map();
  const dummyHash = A.hashPassword('dummy-password-for-timing');
  app.post('/api/auth/login', wrap((req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const key = `${req.ip}|${email}`;
    const a = attempts.get(key);
    if (opts.rateLimit !== false && a && a.count >= 10 && now() - a.first < 15 * 60 * 1000) return res.status(429).json({ error: 'For mange forsøg. Prøv igen senere.' });
    const u = email ? db.prepare('SELECT * FROM users WHERE email=?').get(email) : null;
    const ok = A.verifyPassword(password, u ? u.password_hash : dummyHash) && !!u;
    if (!ok) {
      const cur = a && now() - a.first < 15 * 60 * 1000 ? a : { count: 0, first: now() };
      cur.count++; attempts.set(key, cur);
      return res.status(401).json({ error: 'Forkert e-mail eller adgangskode' });
    }
    attempts.delete(key);
    const token = A.createSession(db, u.id);
    res.cookie('sid', token, { ...cookieBase(), maxAge: A.SESSION_MS });
    res.json({ user: publicUser(u) });
  }));
  app.post('/api/auth/logout', wrap((req, res) => {
    A.destroySession(db, req.sessionToken);
    res.clearCookie('sid', cookieBase());
    res.json({ ok: true });
  }));
  app.post('/api/auth/password', requireAuth, wrap((req, res) => {
    const key = `pw|${req.user.id}`;
    const a = attempts.get(key);
    if (opts.rateLimit !== false && a && a.count >= 10 && now() - a.first < 15 * 60 * 1000) return res.status(429).json({ error: 'For mange forsøg. Prøv igen senere.' });
    const current = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
    if (!row || !A.verifyPassword(current, row.password_hash)) {
      const cur = a && now() - a.first < 15 * 60 * 1000 ? a : { count: 0, first: now() };
      cur.count++; attempts.set(key, cur);
      return res.status(401).json({ error: 'Forkert adgangskode' });
    }
    const nextPw = checkPassword(req.body?.new_password, req.user.role);
    if (current === nextPw) throw bad('Den nye adgangskode skal være forskellig fra den nuværende');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(A.hashPassword(nextPw), req.user.id);
    A.destroyUserSessions(db, req.user.id);
    attempts.delete(key);
    const token = A.createSession(db, req.user.id);
    res.cookie('sid', token, { ...cookieBase(), maxAge: A.SESSION_MS });
    res.json({ ok: true });
  }));
  app.get('/api/me', wrap((req, res) => res.json({ user: publicUser(req.user) })));
  app.get('/api/health', wrap((req, res) => res.json({ ok: true })));

  app.post('/api/auth/register', wrap((req, res) => {
    const b = req.body || {};
    const company = str(b.company_name, { required: true, max: 120, field: 'Firmanavn' });
    const cvr = str(b.cvr, { required: true, max: 20, field: 'CVR' }).replace(/\s|^DK/gi, '');
    if (!/^\d{8}$/.test(cvr)) throw bad('CVR-nummer skal være 8 cifre');
    const city = str(b.city, { required: true, max: 80, field: 'By' });
    const email = checkEmail(b.email);
    const password = checkPassword(b.password, 'dealer');
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'E-mail er allerede i brug');
    if (db.prepare(`SELECT 1 FROM users WHERE cvr=? AND role='dealer' AND status IN ('pending','approved')`).get(cvr)) throw new HttpError(409, 'CVR-nummer er allerede registreret');
    // role/status are NEVER taken from the request: public signup is always a pending dealer.
    db.prepare(`INSERT INTO users (email,name,password_hash,role,status,company_name,cvr,city,created_at) VALUES (?,?,?,'dealer','pending',?,?,?,?)`)
      .run(email, str(b.contact_name, { max: 120 }) || company, A.hashPassword(password), company, cvr, city, new Date(now()).toISOString());
    res.status(201).json({ ok: true, message: 'Din ansøgning er modtaget og afventer godkendelse.' });
  }));

  // ---------- admin: dashboard ----------
  app.get('/api/admin/stats', requireAdmin, wrap((req, res) => {
    expireOrders();
    const one = (sql, ...p) => db.prepare(sql).get(...p).n;
    const recent = db.prepare('SELECT * FROM orders WHERE archived_at IS NULL ORDER BY id DESC LIMIT 5').all().map((o) => orderOut(o, { withDealer: true }));
    res.json({
      vehicles_total: one('SELECT COUNT(*) n FROM vehicles'),
      vehicles_available: one(`SELECT COUNT(*) n FROM vehicles WHERE status='available'`),
      active_packages: db.prepare('SELECT * FROM packages').all().map(pkgOut).filter((p) => p.effective_status === 'available').length,
      orders_total: one('SELECT COUNT(*) n FROM orders WHERE archived_at IS NULL'),
      revenue: one(`SELECT COALESCE(SUM(price),0) n FROM orders WHERE status IN ('confirmed','completed') AND archived_at IS NULL`),
      pending_dealers: one(`SELECT COUNT(*) n FROM users WHERE role='dealer' AND status='pending'`),
      recent_orders: recent,
    });
  }));

  // ---------- admin: vehicles ----------
  function vehicleInput(b, { partial = false } = {}) {
    const v = {};
    v.vin = str(b.vin, { required: true, max: 30, field: 'VIN' }).toUpperCase().replace(/\s/g, '');
    if (!/^[A-Z0-9]{11,17}$/.test(v.vin)) throw bad('VIN skal være 11-17 tegn (bogstaver og tal)');
    v.make = str(b.make, { required: true, max: 60, field: 'Mærke' });
    v.model = str(b.model, { required: true, max: 80, field: 'Model' });
    v.variant = str(b.variant, { max: 120 });
    v.first_registration = str(b.first_registration, { max: 10 });
    if (v.first_registration && !/^\d{4}-\d{2}-\d{2}$/.test(v.first_registration)) throw bad('Første registreringsdato er ugyldig');
    v.mileage = int(b.mileage, { min: 0, max: 5e6, field: 'Kilometer' });
    v.fuel = str(b.fuel, { max: 20 });
    if (v.fuel && !FUELS.includes(v.fuel)) throw bad('Brændstoftype er ugyldig');
    v.transmission = str(b.transmission, { max: 20 });
    if (v.transmission && !TRANSMISSIONS.includes(v.transmission)) throw bad('Gearkasse er ugyldig');
    v.color = str(b.color, { max: 60 });
    v.price = int(b.price, { min: 1, max: 1e9, required: true, field: 'Engrospris' });
    const imgs = Array.isArray(b.images) ? b.images : [];
    if (imgs.length > 40) throw bad('For mange billeder');
    v.images = imgs.map((u) => { if (typeof u !== 'string' || !/^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp|heic)$/.test(u)) throw bad('Ugyldigt billede'); return u; });
    v.condition_report_url = str(b.condition_report_url, { max: 500 });
    if (v.condition_report_url && !/^https?:\/\/[^\s]+$/i.test(v.condition_report_url)) throw bad('Tilstandsrapport skal være en gyldig URL (http/https)');
    return v;
  }
  app.get('/api/admin/vehicles', requireAdmin, wrap((req, res) => {
    expireOrders();
    const where = []; const p = [];
    const q = str(req.query.q, { max: 100 });
    if (q) { where.push(`(vin LIKE ? ESCAPE '\\' OR make LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\')`); const l = `%${likeEsc(q)}%`; p.push(l, l, l); }
    if (req.query.status) { if (!VEHICLE_STATUSES.includes(req.query.status)) throw bad('Ugyldig status'); where.push('status=?'); p.push(req.query.status); }
    if (req.query.fuel) { if (!FUELS.includes(req.query.fuel)) throw bad('Ugyldig brændstoftype'); where.push('fuel=?'); p.push(req.query.fuel); }
    const rows = db.prepare(`SELECT * FROM vehicles ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`).all(...p).map(vehicleOut);
    res.json({ count: rows.length, vehicles: rows });
  }));
  app.get('/api/admin/vehicles/:id', requireAdmin, wrap((req, res) => {
    const v = getVehicle(idParam(req)); if (!v) throw new HttpError(404, 'Bil ikke fundet');
    res.json({ vehicle: withImageIds(v) });
  }));
  app.put('/api/admin/vehicles/:id/images', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    if (!getVehicle(id)) throw new HttpError(404, 'Bil ikke fundet');
    const ids = (req.body || {}).image_ids;
    if (!Array.isArray(ids) || ids.some((n) => !Number.isInteger(n))) throw bad('Billedrækkefølgen er ugyldig');
    const rows = imageRows(id);
    if (ids.length !== rows.length || new Set(ids).size !== ids.length) throw bad('Billedrækkefølgen skal indeholde hvert billede præcis én gang');
    const byId = new Map(rows.map((r) => [r.id, r.url]));
    if (ids.some((imageId) => !byId.has(imageId))) throw bad('Billedrækkefølgen skal indeholde hvert billede præcis én gang');
    const before = db.prepare('SELECT price, status FROM vehicles WHERE id=?').get(id);
    tx(() => {
      ids.forEach((imageId, index) => db.prepare('UPDATE vehicle_images SET position=? WHERE id=? AND vehicle_id=?').run(index + 1, imageId, id));
      db.prepare('UPDATE vehicles SET images=? WHERE id=?').run(JSON.stringify(ids.map((imageId) => byId.get(imageId))), id);
    });
    const after = db.prepare('SELECT price, status FROM vehicles WHERE id=?').get(id);
    if (after.price !== before.price || after.status !== before.status) throw new HttpError(500, 'Billedrækkefølgen må ikke ændre bilen');
    res.json({ vehicle: withImageIds(getVehicle(id)) });
  }));
  app.post('/api/admin/vehicles', requireAdmin, wrap((req, res) => {
    const v = vehicleInput(req.body || {});
    if (db.prepare('SELECT 1 FROM vehicles WHERE vin=?').get(v.vin)) throw new HttpError(409, 'Der findes allerede en bil med dette VIN');
    const id = tx(() => {
      const r = db.prepare(`INSERT INTO vehicles (vin,make,model,variant,first_registration,mileage,fuel,transmission,color,price,images,condition_report_url,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'available', ?)`)
        .run(v.vin, v.make, v.model, v.variant, v.first_registration, v.mileage, v.fuel, v.transmission, v.color, v.price, JSON.stringify(v.images), v.condition_report_url, new Date(now()).toISOString());
      const newId = Number(r.lastInsertRowid);
      syncVehicleImages(newId, v.images);
      return newId;
    });
    res.status(201).json({ vehicle: withImageIds(getVehicle(id)) });
  }));
  app.put('/api/admin/vehicles/:id', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    const cur = getVehicle(id); if (!cur) throw new HttpError(404, 'Bil ikke fundet');
    const v = vehicleInput(req.body || {});
    if (db.prepare('SELECT 1 FROM vehicles WHERE vin=? AND id<>?').get(v.vin, id)) throw new HttpError(409, 'Der findes allerede en bil med dette VIN');
    let status = cur.status;
    if (req.body.status !== undefined && req.body.status !== cur.status) {
      if (!VEHICLE_STATUSES.includes(req.body.status)) throw bad('Ugyldig status');
      const lock = lockingOrder(id);
      if (lock && lock.status === 'pending') throw new HttpError(409, 'Bilen har en aktiv reservation – håndter ordren i stedet');
      if (lock && req.body.status !== 'sold') throw new HttpError(409, 'Bilen indgår i et køb og kan ikke sættes til salg igen');
      status = req.body.status;
    }
    tx(() => {
      db.prepare(`UPDATE vehicles SET vin=?,make=?,model=?,variant=?,first_registration=?,mileage=?,fuel=?,transmission=?,color=?,price=?,images=?,condition_report_url=?,status=? WHERE id=?`)
        .run(v.vin, v.make, v.model, v.variant, v.first_registration, v.mileage, v.fuel, v.transmission, v.color, v.price, JSON.stringify(v.images), v.condition_report_url, status, id);
      syncVehicleImages(id, v.images);
    });
    res.json({ vehicle: withImageIds(getVehicle(id)) });
  }));
  app.delete('/api/admin/vehicles/:id', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    if (!getVehicle(id)) throw new HttpError(404, 'Bil ikke fundet');
    const lock = lockingOrder(id);
    if (lock && lock.status === 'pending') throw new HttpError(409, 'Bilen har en aktiv reservation og kan ikke slettes. Annuller reservationen først.');
    if (lock) throw new HttpError(409, 'Bilen indgår i et køb og kan ikke slettes.');
    db.prepare('DELETE FROM vehicles WHERE id=?').run(id);
    res.json({ ok: true });
  }));

  app.post('/api/admin/uploads', requireAdmin, express.raw({ type: () => true, limit: '15mb' }), wrap((req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Ingen fil modtaget');
    const ext = sniffImage(req.body);
    if (!ext) throw bad('Kun JPG, PNG, HEIC og WebP er tilladt');
    const name = crypto.randomBytes(16).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(uploadDir, name), req.body, { mode: 0o600 });
    res.status(201).json({ url: '/uploads/' + name });
  }));

  // ---------- admin: packages ----------
  function packageInput(b) {
    const name = str(b.name, { required: true, max: 120, field: 'Partinavn' });
    const total_price = int(b.total_price, { min: 1, max: 1e10, required: true, field: 'Total pris' });
    const description = str(b.description, { max: 2000 });
    const ids = Array.isArray(b.vehicle_ids) ? [...new Set(b.vehicle_ids.map(Number))] : [];
    if (ids.length < 1) throw bad('Vælg mindst én bil til partiet');
    if (ids.length > 200) throw bad('For mange biler i partiet');
    ids.forEach((i) => { if (!Number.isInteger(i) || !db.prepare('SELECT 1 FROM vehicles WHERE id=?').get(i)) throw bad('Ugyldig bil i partiet'); });
    return { name, total_price, description, ids };
  }
  function assertPackageMembership(ids, exceptPackageId) {
    ids.forEach((vid) => {
      const v = db.prepare('SELECT status FROM vehicles WHERE id=?').get(vid);
      if (!v || v.status !== 'available' || lockingOrder(vid)) throw new HttpError(409, 'En bil i partiet er ikke tilgængelig');
      const other = db.prepare('SELECT package_id FROM package_vehicles WHERE vehicle_id=? AND package_id<>?').get(vid, exceptPackageId || 0);
      if (other) throw new HttpError(409, 'En bil indgår allerede i et andet parti');
    });
  }
  app.get('/api/admin/packages', requireAdmin, wrap((req, res) => {
    expireOrders();
    res.json({ packages: db.prepare('SELECT * FROM packages ORDER BY id DESC').all().map(pkgOut) });
  }));
  app.get('/api/admin/packages/:id', requireAdmin, wrap((req, res) => {
    expireOrders();
    const p = pkgOut(db.prepare('SELECT * FROM packages WHERE id=?').get(idParam(req)));
    if (!p) throw new HttpError(404, 'Parti ikke fundet');
    res.json({ package: p });
  }));
  app.post('/api/admin/packages', requireAdmin, wrap((req, res) => {
    const p = packageInput(req.body || {});
    const id = tx(() => {
      assertPackageMembership(p.ids, 0);
      const r = db.prepare('INSERT INTO packages (name,total_price,description,created_at) VALUES (?,?,?,?)').run(p.name, p.total_price, p.description, new Date(now()).toISOString());
      const pid = Number(r.lastInsertRowid);
      p.ids.forEach((vid) => db.prepare('INSERT INTO package_vehicles (package_id,vehicle_id) VALUES (?,?)').run(pid, vid));
      db.prepare(`SELECT id FROM users WHERE role='dealer' AND status='approved'`).all().forEach((d) =>
        db.prepare('INSERT INTO notifications (user_id,message,link,created_at) VALUES (?,?,?,?)').run(d.id, `Nyt parti: ${p.name}`, `/shop/packages/${pid}`, new Date(now()).toISOString()));
      return pid;
    });
    res.status(201).json({ package: pkgOut(db.prepare('SELECT * FROM packages WHERE id=?').get(id)) });
  }));
  app.put('/api/admin/packages/:id', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    const cur = db.prepare('SELECT * FROM packages WHERE id=?').get(id); if (!cur) throw new HttpError(404, 'Parti ikke fundet');
    if (cur.status !== 'available') throw new HttpError(409, 'Partiet har en aktiv ordre og kan ikke redigeres');
    const p = packageInput(req.body || {});
    tx(() => {
      assertPackageMembership(p.ids, id);
      db.prepare('UPDATE packages SET name=?,total_price=?,description=? WHERE id=?').run(p.name, p.total_price, p.description, id);
      db.prepare('DELETE FROM package_vehicles WHERE package_id=?').run(id);
      p.ids.forEach((vid) => db.prepare('INSERT INTO package_vehicles (package_id,vehicle_id) VALUES (?,?)').run(id, vid));
    });
    res.json({ package: pkgOut(db.prepare('SELECT * FROM packages WHERE id=?').get(id)) });
  }));
  app.delete('/api/admin/packages/:id', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    if (!db.prepare('SELECT 1 FROM packages WHERE id=?').get(id)) throw new HttpError(404, 'Parti ikke fundet');
    if (db.prepare('SELECT 1 FROM orders WHERE package_id=?').get(id)) throw new HttpError(409, 'Partiet indgår i en ordre og kan ikke slettes');
    db.prepare('DELETE FROM packages WHERE id=?').run(id);
    res.json({ ok: true });
  }));

  // ---------- admin: orders ----------
  const ORDER_LOCKED_FIELDS = ['agreement', 'dealer_id', 'kind', 'status', 'vehicle_id', 'package_id', 'password', 'password_hash', 'role', 'seller'];
  function orderAdminOut(id) {
    return orderOut(db.prepare('SELECT * FROM orders WHERE id=?').get(id), { withDealer: true, withAgreement: true });
  }
  app.get('/api/admin/orders', requireAdmin, wrap((req, res) => {
    expireOrders();
    const archived = req.query.archived === '1';
    const where = [archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'];
    const params = [];
    if (req.query.status) {
      if (!ORDER_STATUSES.includes(req.query.status)) throw bad('Ugyldig status');
      where.push('status=?');
      params.push(req.query.status);
    }
    const rows = db.prepare(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY id DESC`).all(...params);
    res.json({ count: rows.length, orders: rows.map((o) => orderOut(o, { withDealer: true })) });
  }));
  app.put('/api/admin/orders/:id', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    const b = req.body || {};
    for (const key of ORDER_LOCKED_FIELDS) {
      if (b[key] !== undefined) throw bad('Feltet kan ikke ændres her');
    }
    tx(() => {
      const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
      if (!o) throw new HttpError(404, 'Ordre ikke fundet');
      if (o.archived_at) throw new HttpError(409, 'En arkiveret ordre kan ikke redigeres. Gendan den først.');
      const agreementBefore = o.agreement;
      let label = o.item_label;
      if (b.item_label !== undefined) label = str(b.item_label, { required: true, max: 200, field: 'Vare' });
      let note = o.admin_note;
      if (b.admin_note !== undefined) note = str(b.admin_note, { max: 1000, field: 'Intern note' });
      let expires = o.expires_at;
      if (b.expires_at !== undefined) {
        if (!(o.kind === 'reserve' && o.status === 'pending')) throw bad('Udløb kan kun ændres på en afventende reservation');
        const raw = str(b.expires_at, { required: true, max: 40, field: 'Udløb' });
        const ms = Date.parse(raw);
        if (!Number.isFinite(ms)) throw bad('Udløb er ugyldigt');
        expires = new Date(ms).toISOString();
      }
      let price = o.price;
      if (b.price !== undefined && b.price !== '' && int(b.price, { min: 1, max: 1e10, required: true, field: 'Pris' }) !== o.price) {
        price = int(b.price, { min: 1, max: 1e10, required: true, field: 'Pris' });
        const reason = str(b.correction_reason, { required: true, max: 500, field: 'Begrundelse' });
        db.prepare('INSERT INTO order_corrections (order_id, previous_price, new_price, reason, admin_id, created_at) VALUES (?,?,?,?,?,?)')
          .run(id, o.price, price, reason, req.user.id, new Date(now()).toISOString());
      }
      db.prepare('UPDATE orders SET item_label=?, admin_note=?, expires_at=?, price=? WHERE id=?').run(label, note, expires, price, id);
      const after = db.prepare('SELECT agreement FROM orders WHERE id=?').get(id).agreement;
      if (after !== agreementBefore) throw new HttpError(500, 'Aftalen må ikke ændres');
    });
    res.json({ order: orderAdminOut(id) });
  }));
  function archiveOrder(id, admin, note) {
    return tx(() => {
      const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
      if (!o) throw new HttpError(404, 'Ordre ikke fundet');
      if (o.archived_at) throw new HttpError(409, 'Ordren er allerede arkiveret');
      const agreementBefore = o.agreement;
      if (o.status === 'pending') releaseOrder(o);
      db.prepare('UPDATE orders SET archived_at=?, archived_by=?, archive_note=?, expires_at=CASE WHEN status=\'pending\' THEN NULL ELSE expires_at END WHERE id=?')
        .run(new Date(now()).toISOString(), admin.id, note, id);
      const after = db.prepare('SELECT agreement, price FROM orders WHERE id=?').get(id);
      if (after.agreement !== agreementBefore || after.price !== o.price) throw new HttpError(500, 'Aftalen må ikke ændres');
      return id;
    });
  }
  function restoreOrder(id) {
    return tx(() => {
      const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
      if (!o) throw new HttpError(404, 'Ordre ikke fundet');
      if (!o.archived_at) throw new HttpError(409, 'Ordren er ikke arkiveret');
      const agreementBefore = o.agreement;
      const vids = orderVehicles(o.id);
      if (o.status === 'pending') {
        for (const vid of vids) {
          const v = db.prepare('SELECT status FROM vehicles WHERE id=?').get(vid);
          if (!v || v.status !== 'available' || lockingOrder(vid, id)) throw new HttpError(409, 'Ordren kan ikke gendannes, fordi en bil ikke længere er ledig');
        }
        if (o.package_id) {
          const p = db.prepare('SELECT status FROM packages WHERE id=?').get(o.package_id);
          if (!p || p.status !== 'available') throw new HttpError(409, 'Partiet er ikke længere ledigt');
        }
        for (const vid of vids) {
          if (db.prepare(`UPDATE vehicles SET status='reserved' WHERE id=? AND status='available'`).run(vid).changes !== 1) throw new HttpError(409, 'Ordren kan ikke gendannes, fordi en bil ikke længere er ledig');
        }
        if (o.package_id && db.prepare(`UPDATE packages SET status='reserved' WHERE id=? AND status='available'`).run(o.package_id).changes !== 1) throw new HttpError(409, 'Partiet er ikke længere ledigt');
        db.prepare('UPDATE orders SET archived_at=NULL, archived_by=NULL, archive_note=NULL, expires_at=? WHERE id=?').run(new Date(now() + RESERVE_MS).toISOString(), id);
      } else if (o.status === 'confirmed' || o.status === 'completed') {
        for (const vid of vids) {
          const v = db.prepare('SELECT status FROM vehicles WHERE id=?').get(vid);
          if (v && v.status !== 'sold') throw new HttpError(409, 'Gendannelse sætter ikke en ledig eller reserveret bil til solgt. Ordren forbliver arkiveret.');
        }
        if (o.package_id) {
          const p = db.prepare('SELECT status FROM packages WHERE id=?').get(o.package_id);
          if (p && p.status !== 'sold') throw new HttpError(409, 'Gendannelse ændrer ikke partiets lagerstatus. Ordren forbliver arkiveret.');
        }
        db.prepare('UPDATE orders SET archived_at=NULL, archived_by=NULL, archive_note=NULL WHERE id=?').run(id);
      } else {
        db.prepare('UPDATE orders SET archived_at=NULL, archived_by=NULL, archive_note=NULL WHERE id=?').run(id);
      }
      const after = db.prepare('SELECT agreement, price FROM orders WHERE id=?').get(id);
      if (after.agreement !== agreementBefore || after.price !== o.price) throw new HttpError(500, 'Aftalen må ikke ændres');
      return id;
    });
  }
  app.post('/api/admin/orders/:id/archive', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    const note = str((req.body || {}).note, { max: 500, field: 'Note' });
    archiveOrder(id, req.user, note);
    res.json({ order: orderAdminOut(id) });
  }));
  app.post('/api/admin/orders/:id/restore', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    restoreOrder(id);
    res.json({ order: orderAdminOut(id) });
  }));
  app.post('/api/admin/orders/:id/:action', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    const action = req.params.action;
    if (!['confirm', 'complete', 'cancel'].includes(action)) throw new HttpError(404, 'Ukendt handling');
    expireOrders();
    tx(() => {
      const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
      if (!o) throw new HttpError(404, 'Ordre ikke fundet');
      if (o.archived_at) throw new HttpError(409, 'En arkiveret ordre kan ikke ændres. Gendan den først.');
      if (action === 'confirm') {
        if (o.status !== 'pending') throw new HttpError(409, 'Kun afventende ordrer kan bekræftes');
        db.prepare(`UPDATE orders SET status='confirmed', expires_at=NULL WHERE id=?`).run(id);
        setOrderItemsStatus(o, 'sold');
      } else if (action === 'complete') {
        if (o.status !== 'confirmed') throw new HttpError(409, 'Kun bekræftede ordrer kan gennemføres');
        db.prepare(`UPDATE orders SET status='completed' WHERE id=?`).run(id);
        setOrderItemsStatus(o, 'sold');
      } else {
        if (!['pending', 'confirmed'].includes(o.status)) throw new HttpError(409, 'Ordren kan ikke annulleres');
        db.prepare(`UPDATE orders SET status='cancelled' WHERE id=?`).run(id);
        releaseOrder(o);
      }
    });
    res.json({ order: orderOut(db.prepare('SELECT * FROM orders WHERE id=?').get(id), { withDealer: true }) });
  }));

  // ---------- admin: dealers / admins ----------
  app.get('/api/admin/dealers', requireAdmin, wrap((req, res) => {
    const rows = db.prepare(`SELECT id,email,name,company_name,cvr,city,status,created_at FROM users WHERE role='dealer' ORDER BY id DESC`).all();
    res.json({ dealers: rows });
  }));
  app.put('/api/admin/dealers/:id', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    const b = req.body || {};
    for (const key of ['password', 'password_hash', 'role', 'status']) {
      if (b[key] !== undefined) throw bad('Feltet kan ikke ændres her');
    }
    const company = str(b.company_name, { required: true, max: 120, field: 'Firmanavn' });
    const cvr = str(b.cvr, { required: true, max: 20, field: 'CVR' }).replace(/\s|^DK/gi, '');
    if (!/^\d{8}$/.test(cvr)) throw bad('CVR-nummer skal være 8 cifre');
    const city = str(b.city, { required: true, max: 80, field: 'By' });
    const name = str(b.name, { required: true, max: 120, field: 'Navn' });
    const email = checkEmail(b.email);
    const d = db.prepare(`SELECT id, role, password_hash FROM users WHERE id=? AND role='dealer'`).get(id);
    if (!d) throw new HttpError(404, 'Forhandler ikke fundet');
    if (db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(email, id)) throw new HttpError(409, 'E-mail er allerede i brug');
    if (db.prepare(`SELECT 1 FROM users WHERE cvr=? AND role='dealer' AND status IN ('pending','approved') AND id<>?`).get(cvr, id)) throw new HttpError(409, 'CVR-nummer er allerede registreret');
    db.prepare(`UPDATE users SET company_name=?, cvr=?, city=?, name=?, email=? WHERE id=? AND role='dealer'`).run(company, cvr, city, name, email, id);
    const row = db.prepare('SELECT id,email,name,company_name,cvr,city,status,role,password_hash FROM users WHERE id=?').get(id);
    if (row.role !== 'dealer' || row.password_hash !== d.password_hash) throw new HttpError(500, 'Kontoen må ikke ændre rolle eller adgangskode');
    res.json({ dealer: { id: row.id, email: row.email, name: row.name, company_name: row.company_name, cvr: row.cvr, city: row.city, status: row.status } });
  }));
  app.post('/api/admin/dealers/:id/:action', requireAdmin, wrap((req, res) => {
    const id = idParam(req);
    const map = { approve: 'approved', reject: 'rejected' };
    const status = map[req.params.action]; if (!status) throw new HttpError(404, 'Ukendt handling');
    const d = db.prepare(`SELECT * FROM users WHERE id=? AND role='dealer'`).get(id);
    if (!d) throw new HttpError(404, 'Forhandler ikke fundet');
    db.prepare('UPDATE users SET status=? WHERE id=?').run(status, id);
    res.json({ dealer: { id, status } });
  }));
  app.post('/api/admin/admins', requireAdmin, wrap((req, res) => {
    const b = req.body || {};
    const email = checkEmail(b.email);
    const name = str(b.name, { required: true, max: 120, field: 'Navn' });
    const password = checkPassword(b.password, 'admin');
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'E-mail er allerede i brug');
    const r = db.prepare(`INSERT INTO users (email,name,password_hash,role,status,created_at) VALUES (?,?,?,'admin','approved',?)`).run(email, name, A.hashPassword(password), new Date(now()).toISOString());
    res.status(201).json({ admin: { id: Number(r.lastInsertRowid), email, name } });
  }));

  // ---------- dealer shop ----------
  app.get('/api/shop/vehicles', requireDealer, wrap((req, res) => {
    expireOrders();
    const where = [`status='available'`, `NOT EXISTS (SELECT 1 FROM order_vehicles ov JOIN orders o ON o.id=ov.order_id WHERE ov.vehicle_id=vehicles.id AND ${LOCK_SQL})`]; const p = [];
    const q = str(req.query.q, { max: 100 });
    if (q) { where.push(`(make LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR variant LIKE ? ESCAPE '\\')`); const l = `%${likeEsc(q)}%`; p.push(l, l, l); }
    if (req.query.fuel) { if (!FUELS.includes(req.query.fuel)) throw bad('Ugyldig brændstoftype'); where.push('fuel=?'); p.push(req.query.fuel); }
    res.json({ vehicles: db.prepare(`SELECT * FROM vehicles WHERE ${where.join(' AND ')} ORDER BY id DESC`).all(...p).map(vehicleOut) });
  }));
  const myHold = (vehicleId, dealerId) => db.prepare(`SELECT o.* FROM order_vehicles ov JOIN orders o ON o.id=ov.order_id WHERE ov.vehicle_id=? AND o.dealer_id=? AND o.status='pending' AND o.kind='reserve' AND o.archived_at IS NULL`).get(vehicleId, dealerId);
  app.get('/api/shop/vehicles/:id', requireDealer, wrap((req, res) => {
    expireOrders();
    const v = getVehicle(idParam(req));
    const mine = v && myHold(v.id, req.user.id);
    if (!v || saleLocked(v.id) || (!mine && (v.status !== 'available' || lockingOrder(v.id)))) throw new HttpError(404, 'Bilen er ikke tilgængelig');
    res.json({ vehicle: v, my_reservation: mine ? orderOut(mine) : null });
  }));
  app.get('/api/shop/packages', requireDealer, wrap((req, res) => {
    expireOrders();
    res.json({ packages: db.prepare(`SELECT * FROM packages WHERE status='available' ORDER BY id DESC`).all().map(pkgOut).filter((p) => p.effective_status === 'available') });
  }));
  app.get('/api/shop/packages/:id', requireDealer, wrap((req, res) => {
    expireOrders();
    const p = pkgOut(db.prepare('SELECT * FROM packages WHERE id=?').get(idParam(req)));
    if (!p || p.effective_status !== 'available') throw new HttpError(404, 'Partiet er ikke tilgængeligt');
    res.json({ package: p });
  }));
  function dealerAction(kind, target) {
    return wrap((req, res) => {
      expireOrders();
      const id = idParam(req);
      const orderId = tx(() => {
        if (kind === 'buy') requireSeller();
        if (target === 'vehicle') {
          const v = getVehicle(id); if (!v) throw new HttpError(404, 'Bilen findes ikke');
          const mine = kind === 'buy' ? myHold(id, req.user.id) : null;
          if (saleLocked(id) || lockingOrder(id, mine ? mine.id : 0)) throw new HttpError(409, 'Bilen er ikke længere tilgængelig');
          if (mine) { // convert own reservation into a purchase
            const claimed = db.prepare(`UPDATE orders SET kind='buy', status='confirmed', expires_at=NULL, price=? WHERE id=? AND dealer_id=? AND status='pending' AND kind='reserve'`).run(v.price, mine.id, req.user.id);
            if (claimed.changes !== 1) throw new HttpError(409, 'Reservationen kan ikke længere omsættes til køb');
            if (db.prepare(`UPDATE vehicles SET status='sold' WHERE id=? AND status='reserved'`).run(id).changes !== 1) throw new HttpError(409, 'Bilen er ikke længere tilgængelig');
            const o = db.prepare('SELECT * FROM orders WHERE id=?').get(mine.id);
            db.prepare('UPDATE orders SET agreement=? WHERE id=?').run(JSON.stringify(buildAgreement(o, req.user, [v])), mine.id);
            return mine.id;
          }
          if (v.status !== 'available') throw new HttpError(409, 'Bilen er ikke længere tilgængelig');
          return createOrder({ dealer: req.user, kind, vehicle: v });
        }
        const p = pkgOut(db.prepare('SELECT * FROM packages WHERE id=?').get(id)); if (!p) throw new HttpError(404, 'Partiet findes ikke');
        const mine = kind === 'buy' ? db.prepare(`SELECT * FROM orders WHERE package_id=? AND dealer_id=? AND status='pending' AND kind='reserve' AND archived_at IS NULL`).get(id, req.user.id) : null;
        for (const c of p.vehicles) {
          if (lockingOrder(c.id, mine ? mine.id : 0)) throw new HttpError(409, 'Bilen er ikke længere tilgængelig');
        }
        if (mine) {
          const claimed = db.prepare(`UPDATE orders SET kind='buy', status='confirmed', expires_at=NULL, price=? WHERE id=? AND dealer_id=? AND status='pending' AND kind='reserve'`).run(p.total_price, mine.id, req.user.id);
          if (claimed.changes !== 1) throw new HttpError(409, 'Reservationen kan ikke længere omsættes til køb');
          const o = db.prepare('SELECT * FROM orders WHERE id=?').get(mine.id);
          const claim = db.prepare(`UPDATE vehicles SET status='sold' WHERE id=? AND status='reserved'`);
          for (const vid of orderVehicles(o.id)) {
            if (claim.run(vid).changes !== 1) throw new HttpError(409, 'Bilen er ikke længere tilgængelig');
          }
          if (db.prepare(`UPDATE packages SET status='sold' WHERE id=? AND status='reserved'`).run(id).changes !== 1) throw new HttpError(409, 'Partiet er ikke længere tilgængeligt');
          db.prepare('UPDATE orders SET agreement=? WHERE id=?').run(JSON.stringify(buildAgreement(o, req.user, p.vehicles)), mine.id);
          return mine.id;
        }
        if (p.effective_status !== 'available') throw new HttpError(409, 'Partiet er ikke længere tilgængeligt');
        return createOrder({ dealer: req.user, kind, pkg: p });
      });
      res.status(201).json({ order: orderOut(db.prepare('SELECT * FROM orders WHERE id=?').get(orderId), { withAgreement: true }) });
    });
  }
  app.post('/api/shop/vehicles/:id/reserve', requireDealer, dealerAction('reserve', 'vehicle'));
  app.post('/api/shop/vehicles/:id/buy', requireDealer, dealerAction('buy', 'vehicle'));
  app.post('/api/shop/packages/:id/reserve', requireDealer, dealerAction('reserve', 'package'));
  app.post('/api/shop/packages/:id/buy', requireDealer, dealerAction('buy', 'package'));

  app.get('/api/shop/orders', requireDealer, wrap((req, res) => {
    expireOrders();
    res.json({ orders: db.prepare('SELECT * FROM orders WHERE dealer_id=? ORDER BY id DESC').all(req.user.id).map((o) => orderOut(o)) });
  }));
  app.post('/api/shop/orders/:id/cancel', requireDealer, wrap((req, res) => {
    expireOrders();
    const id = idParam(req);
    tx(() => {
      const o = db.prepare('SELECT * FROM orders WHERE id=? AND dealer_id=?').get(id, req.user.id);
      if (!o) throw new HttpError(404, 'Ordre ikke fundet');
      if (o.archived_at) throw new HttpError(409, 'Ordren er arkiveret');
      if (o.status !== 'pending') throw new HttpError(409, 'Kun afventende reservationer kan annulleres');
      db.prepare(`UPDATE orders SET status='cancelled' WHERE id=?`).run(id);
      releaseOrder(o);
    });
    res.json({ ok: true });
  }));
  app.get('/api/shop/notifications', requireDealer, wrap((req, res) => {
    res.json({ notifications: db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 20').all(req.user.id) });
  }));
  app.post('/api/shop/notifications/read', requireDealer, wrap((req, res) => {
    db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
    res.json({ ok: true });
  }));

  // Orders + agreement: owner dealer or admin
  app.get('/api/orders/:id', requireAuth, wrap((req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(idParam(req));
    const allowed = o && (req.user.role === 'admin' || (req.user.role === 'dealer' && req.user.status === 'approved' && o.dealer_id === req.user.id));
    if (!allowed) throw new HttpError(404, 'Ordre ikke fundet');
    res.json({ order: orderOut(o, { withDealer: req.user.role === 'admin', withAgreement: true }) });
  }));

  // ---------- static ----------
  const userFromReq = (req) => A.userFromToken(db, A.parseCookies(req.headers.cookie).sid);
  app.use('/uploads', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).type('text/plain').send('Ikke fundet');
    const u = userFromReq(req);
    if (!u) return res.status(401).type('text/plain').send('Du skal være logget ind');
    if (!(u.role === 'admin' || (u.role === 'dealer' && u.status === 'approved'))) return res.status(403).type('text/plain').send('Ingen adgang');
    let rel = '';
    try { rel = decodeURIComponent(String(req.path || '')); }
    catch { return res.status(404).type('text/plain').send('Ikke fundet'); }
    rel = rel.replace(/^\/uploads\//, '').replace(/^\//, '');
    if (!/^[a-f0-9]{32}\.(jpg|png|webp|heic)$/.test(rel)) return res.status(404).type('text/plain').send('Ikke fundet');
    const full = path.resolve(uploadDir, rel);
    const root = path.resolve(uploadDir);
    let st;
    try { st = fs.lstatSync(full); }
    catch { return res.status(404).type('text/plain').send('Ikke fundet'); }
    if (st.isSymbolicLink() || !st.isFile()) return res.status(404).type('text/plain').send('Ikke fundet');
    let real;
    let rootReal;
    try { real = fs.realpathSync(full); rootReal = fs.realpathSync(root); }
    catch { return res.status(404).type('text/plain').send('Ikke fundet'); }
    if (real !== path.join(rootReal, rel)) return res.status(404).type('text/plain').send('Ikke fundet');
    res.sendFile(real, {
      dotfiles: 'deny',
      headers: { 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' },
    }, (err) => { if (err) next(err); });
  });
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Ikke fundet' }));
  app.use((req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  app.use((err, req, res, next) => { // eslint-disable-line
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ugyldig JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Filen er for stor' });
    if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
      return res.status(err.status).type('text/plain').send(err.status === 404 ? 'Ikke fundet' : 'Ugyldig anmodning');
    }
    console.error('request failed');
    res.status(500).json({ error: 'Der opstod en fejl' });
  });

  const timer = opts.noTimer ? null : setInterval(() => { try { expireOrders(); } catch (e) { console.error('expire failed'); } }, 15000);
  if (timer) timer.unref();
  return { app, db, bootstrap, expireOrders, close: () => { if (timer) clearInterval(timer); db.close(); } };
}
module.exports = { createApp };
