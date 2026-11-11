'use strict';
const { createApp } = require('./src/app');
const { assertLoopbackHost, resolveTrustProxy, loadBootstrapConfig } = require('./src/runtime-config');

const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT === undefined || process.env.PORT === '' ? 4310 : Number(process.env.PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PORT is invalid.');
  process.exit(1);
}
try {
  if (process.env.ENFORCE_LOOPBACK === '1') assertLoopbackHost(host);
  resolveTrustProxy(process.env.TRUST_PROXY);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

let bootstrapEnv;
try {
  bootstrapEnv = loadBootstrapConfig(process.env);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

process.umask(0o077);
const { app, db } = createApp({
  cookieSecure: process.env.COOKIE_SECURE === '1',
  trustProxy: process.env.TRUST_PROXY,
  env: bootstrapEnv,
  bootstrapLog: true,
  ...(process.env.DB_FILE ? { dbFile: process.env.DB_FILE } : {}),
  ...(process.env.UPLOAD_DIR ? { uploadDir: process.env.UPLOAD_DIR } : {}),
});

if (process.env.REQUIRE_ADMIN === '1') {
  const ownerEmail = String(bootstrapEnv.OWNER_EMAIL || bootstrapEnv.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const n = Number(db.prepare(`SELECT COUNT(*) AS n FROM users WHERE (role='admin' AND status='approved') OR (? <> '' AND lower(email)=?)`).get(ownerEmail, ownerEmail).n);
  if (!n) {
    console.error('Refusing to start: no approved admin exists. Put BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD in the secrets file and start against an empty database, or restore a database that already has an admin. No default account was created.');
    try { db.close(); } catch { /* ignore */ }
    process.exit(1);
  }
}

const server = app.listen(port, host, () => {
  const addr = server.address();
  console.log(`AutoB2B listening on http://${host}:${addr && addr.port ? addr.port : port}`);
});
server.on('error', (err) => {
  console.error('Failed to listen:', err && err.code ? err.code : 'error');
  process.exit(1);
});

function shutdown() {
  server.close(() => {
    try { db.close(); } catch { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
