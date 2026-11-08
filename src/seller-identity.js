'use strict';

const SELLER_KEYS = ['SELLER_LEGAL_NAME', 'SELLER_CVR', 'SELLER_ADDRESS'];
const BUY_CLOSED = 'Køb er lukket, fordi sælgeroplysningerne mangler eller er ugyldige.';

function cleanLine(value, max) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || s.length > max) return null;
  if (/[\u0000-\u001F\u007F\u2028\u2029]/.test(s)) return null;
  return s;
}

function parseSellerIdentity(src) {
  const input = src || {};
  const name = cleanLine(input.SELLER_LEGAL_NAME, 200);
  const cvr = cleanLine(input.SELLER_CVR, 8);
  const address = cleanLine(input.SELLER_ADDRESS, 300);
  if (!name || !cvr || !/^\d{8}$/.test(cvr) || !address) return { ok: false, seller: null };
  return { ok: true, seller: { name, cvr, address } };
}

module.exports = { SELLER_KEYS, BUY_CLOSED, parseSellerIdentity };
