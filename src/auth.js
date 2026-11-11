'use strict';
const crypto = require('node:crypto');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, saltHex, keyHex] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
  } catch { return false; }
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SESSION_MS = 7 * 24 * 3600 * 1000;

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(sha(token), userId, Date.now() + SESSION_MS);
  return token;
}
function destroySession(db, token) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token)); }
function destroyUserSessions(db, userId) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); }
function userFromToken(db, token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(sha(token), Date.now());
  return row || null;
}
function parseCookies(h) {
  const out = {};
  String(h || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i <= 0) return;
    try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
    catch { /* ignore a malformed cookie rather than failing the request */ }
  });
  return out;
}
module.exports = { hashPassword, verifyPassword, createSession, destroySession, destroyUserSessions, userFromToken, parseCookies, SESSION_MS };
