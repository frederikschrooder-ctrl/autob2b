'use strict';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function ownerEmail(env) {
  const src = env || {};
  return normalizeEmail(src.OWNER_EMAIL || src.BOOTSTRAP_ADMIN_EMAIL || '');
}

function headEmails(env) {
  return String((env || {}).HEAD_ADMIN_EMAILS || '')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean);
}

function tiersConfigured(env) {
  return !!(ownerEmail(env) || headEmails(env).length);
}

function headFlag(user) {
  if (!user || user.head_admin == null || user.head_admin === '') return null;
  const n = Number(user.head_admin);
  if (n === 1) return 1;
  if (n === 0) return 0;
  return null;
}

function accountTier(user, env) {
  if (!user) return null;
  const email = normalizeEmail(user.email);
  const owner = ownerEmail(env);
  if (owner && email === owner) return 'owner';
  const flag = headFlag(user);
  if (flag !== 0 && (flag === 1 || headEmails(env).includes(email))) return 'head';
  if (user.role === 'admin') return 'admin';
  return 'dealer';
}

function hasAdminAccess(user, env) {
  const tier = accountTier(user, env);
  return tier === 'owner' || tier === 'head' || tier === 'admin';
}

function canManageAdmins(user, env) {
  const tier = accountTier(user, env);
  if (tier === 'owner' || tier === 'head') return true;
  return !tiersConfigured(env) && !!(user && user.role === 'admin');
}

function canGrantHead(user, env) {
  return accountTier(user, env) === 'owner';
}

module.exports = {
  normalizeEmail,
  ownerEmail,
  headEmails,
  tiersConfigured,
  accountTier,
  hasAdminAccess,
  canManageAdmins,
  canGrantHead,
};
