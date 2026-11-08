'use strict';
const fs = require('node:fs');

const BOOTSTRAP_KEYS = ['BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD', 'BOOTSTRAP_ADMIN_NAME'];

function assertLoopbackHost(host) {
  const h = String(host || '');
  if (h !== '127.0.0.1' && h !== '::1' && h !== 'localhost') {
    throw new Error('HOST must be a loopback address (127.0.0.1). Refusing to listen on a public interface.');
  }
}

function resolveTrustProxy(value) {
  if (value == null || value === false || value === '' || value === 'false' || value === '0') return false;
  if (value === 'loopback') return 'loopback';
  throw new Error('TRUST_PROXY must be unset or loopback. Trusting every proxy is not allowed.');
}

function parseEnvFile(text) {
  const out = {};
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '');
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = raw.indexOf('=');
    if (eq < 1) throw new Error(`Secrets file line ${i + 1} is not KEY=VALUE.`);
    const key = raw.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Secrets file line ${i + 1} has an invalid key.`);
    let val = raw.slice(eq + 1);
    if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2) || (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function loadBootstrapConfig(env) {
  const src = env || {};
  if (!src.SECRETS_FILE) {
    return {
      BOOTSTRAP_ADMIN_EMAIL: src.BOOTSTRAP_ADMIN_EMAIL || '',
      BOOTSTRAP_ADMIN_PASSWORD: typeof src.BOOTSTRAP_ADMIN_PASSWORD === 'string' ? src.BOOTSTRAP_ADMIN_PASSWORD : '',
      BOOTSTRAP_ADMIN_NAME: src.BOOTSTRAP_ADMIN_NAME || '',
    };
  }
  const file = src.SECRETS_FILE;
  let st;
  try { st = fs.lstatSync(file); }
  catch { throw new Error('SECRETS_FILE does not exist. Create the root-only secrets file before starting.'); }
  if (st.isSymbolicLink()) throw new Error('SECRETS_FILE must be a regular file, not a symlink.');
  if (!st.isFile()) throw new Error('SECRETS_FILE must be a regular file. If Docker created a directory, remove it and create the secrets file first.');
  if (st.size > 16384) throw new Error('SECRETS_FILE is unexpectedly large.');
  if (st.mode & 0o077) throw new Error('SECRETS_FILE permissions are too open. Use chmod 600 and owner root.');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch { throw new Error('SECRETS_FILE could not be read.'); }
  const parsed = parseEnvFile(text);
  const unknown = Object.keys(parsed).filter((k) => !BOOTSTRAP_KEYS.includes(k));
  if (unknown.length) throw new Error('SECRETS_FILE contains unsupported keys: ' + unknown.join(', ') + '.');
  return {
    BOOTSTRAP_ADMIN_EMAIL: parsed.BOOTSTRAP_ADMIN_EMAIL || '',
    BOOTSTRAP_ADMIN_PASSWORD: typeof parsed.BOOTSTRAP_ADMIN_PASSWORD === 'string' ? parsed.BOOTSTRAP_ADMIN_PASSWORD : '',
    BOOTSTRAP_ADMIN_NAME: parsed.BOOTSTRAP_ADMIN_NAME || '',
  };
}

module.exports = { assertLoopbackHost, resolveTrustProxy, loadBootstrapConfig, parseEnvFile, BOOTSTRAP_KEYS };
