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

function isConfiguredTierEmail(email, env) {
  const value = normalizeEmail(email);
  if (!value) return false;
  if (value === ownerEmail(env)) return true;
  return headEmails(env).includes(value);
}

function headFlag(user) {
  if (!user || user.head_admin == null || user.head_admin === '') return null;
  const n = Number(user.head_admin);
  if (n === 1) return 1;
  if (n === 0) return 0;
  return null;
}

function accountTier(user, env, opts) {
  if (!user) return null;
  const email = normalizeEmail(user.email);
  const owner = ownerEmail(env);
  const approved = user.status === 'approved';
  const extra = opts || {};
  if (approved && owner && email === owner) return 'owner';
  if (approved && !owner && user.role === 'admin' && extra.fallbackOwnerId != null && Number(user.id) === Number(extra.fallbackOwnerId)) return 'owner';
  const flag = headFlag(user);
  if (approved && flag !== 0 && (flag === 1 || headEmails(env).includes(email))) return 'head';
  if (user.role === 'admin') return 'admin';
  return 'dealer';
}

function hasAdminAccess(user, env, opts) {
  const tier = accountTier(user, env, opts);
  return tier === 'owner' || tier === 'head' || tier === 'admin';
}

function canManageAdmins(user, env, opts) {
  const tier = accountTier(user, env, opts);
  if (tier === 'owner' || tier === 'head') return true;
  return !tiersConfigured(env) && !!(user && user.role === 'admin');
}

function canGrantHead(user, env, opts) {
  return accountTier(user, env, opts) === 'owner';
}

module.exports = {
  normalizeEmail,
  ownerEmail,
  headEmails,
  tiersConfigured,
  isConfiguredTierEmail,
  accountTier,
  hasAdminAccess,
  canManageAdmins,
  canGrantHead,
};
