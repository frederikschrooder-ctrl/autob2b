'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN_MIN = 4;
const DEALER_MIN = 10;
const MAX = 200;

let denylist;

function forbiddenDigests() {
  if (!denylist) {
    const text = fs.readFileSync(path.join(__dirname, 'forbidden-password-sha256.txt'), 'utf8');
    denylist = text.split('\n').map((line) => line.replace(/#.*/, '').trim().toLowerCase()).filter((line) => /^[0-9a-f]{64}$/.test(line));
  }
  return denylist;
}

function minLengthForRole(role) {
  return role === 'admin' ? ADMIN_MIN : DEALER_MIN;
}

function isForbiddenPassword(password) {
  const digest = crypto.createHash('sha256').update(String(password), 'utf8').digest();
  return forbiddenDigests().some((hex) => {
    const row = Buffer.from(hex, 'hex');
    return row.length === digest.length && crypto.timingSafeEqual(row, digest);
  });
}

function passwordPolicyError(password, { min }) {
  if (typeof password !== 'string' || password.length < min) return `Adgangskoden skal være mindst ${min} tegn`;
  if (password.length > MAX) return 'Adgangskoden er for lang';
  if (isForbiddenPassword(password)) return 'Den adgangskode kan ikke bruges. Vælg en anden.';
  return null;
}

module.exports = { ADMIN_MIN, DEALER_MIN, MAX, minLengthForRole, isForbiddenPassword, passwordPolicyError };
