'use strict';
const { hashPassword } = require('./auth');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const PLACEHOLDERS = new Set([
  'changeme',
  'change-me',
  'password',
  'password123',
  'admin',
  'admin123',
  'replace-me',
  'replace-with-a-long-random-password',
]);

/**
 * Create the first approved admin once. Never updates an existing password,
 * role, or status. `env` must already be the bootstrap values only.
 * Log callbacks must not receive the email or password.
 */
function bootstrapAdmin(db, env = {}, opts = {}) {
  const log = opts.log || (() => {});
  const error = opts.error || (() => {});
  const email = String(env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = typeof env.BOOTSTRAP_ADMIN_PASSWORD === 'string' ? env.BOOTSTRAP_ADMIN_PASSWORD : '';
  const nameRaw = String(env.BOOTSTRAP_ADMIN_NAME || '').trim();
  const name = nameRaw || 'Administrator';
  const adminCount = Number(db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role='admin'`).get().n);

  if (adminCount > 0) {
    if (email || password) log('Admin bootstrap skipped because an admin account already exists. No passwords were changed.');
    return { created: false, reason: 'admin-exists' };
  }
  if (!email && !password) {
    log('No admin account exists. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD to create the first admin. No default account was created.');
    return { created: false, reason: 'not-configured' };
  }
  if (!email || !password) {
    error('Admin bootstrap refused: both email and password are required. No account was created.');
    return { created: false, reason: 'incomplete' };
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    error('Admin bootstrap refused: email is invalid. No account was created.');
    return { created: false, reason: 'invalid-email' };
  }
  if (password.length < 10 || password.length > 200 || PLACEHOLDERS.has(password.toLowerCase()) || password.toLowerCase() === email) {
    error('Admin bootstrap refused: password does not meet the policy (10-200 characters, not a placeholder, not the email). No account was created.');
    return { created: false, reason: 'weak-password' };
  }
  if (name.length > 120 || /[\r\n]/.test(name)) {
    error('Admin bootstrap refused: name is invalid. No account was created.');
    return { created: false, reason: 'invalid-name' };
  }
  const existing = db.prepare('SELECT id, role FROM users WHERE email=?').get(email);
  if (existing) {
    error('Admin bootstrap refused: that email already belongs to an account. No passwords were changed.');
    return { created: false, reason: 'email-taken' };
  }
  db.prepare(`INSERT INTO users (email,name,password_hash,role,status) VALUES (?,?,?,'admin','approved')`)
    .run(email, name, hashPassword(password));
  log('Created the first admin account from bootstrap configuration. Later startups will not reset this password.');
  return { created: true, reason: 'created' };
}

module.exports = { bootstrapAdmin };
