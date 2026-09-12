const crypto = require('node:crypto');
const {
  getEntitlement,
  countUsageThisMonth,
  insertUsageEvent,
  listUsageDaily,
} = require('./db');

function newRequestId() {
  return crypto.randomUUID();
}

function getEntitlementState(guildId) {
  const row = getEntitlement(guildId);
  const used = countUsageThisMonth(guildId);
  const limit = Number(row.monthly_limit || 0);
  const unlimited = limit <= 0 || row.plan === 'internal';
  const allowed =
    row.status === 'active' && row.plan !== 'suspended' && (unlimited || used < limit);
  return {
    guildId: String(guildId),
    plan: row.plan,
    status: row.status,
    monthlyLimit: limit,
    used,
    remaining: unlimited ? null : Math.max(0, limit - used),
    unlimited,
    allowed,
    resetAt: null,
  };
}

function assertEntitlement(guildId) {
  const state = getEntitlementState(guildId);
  if (state.allowed) {
    return state;
  }
  const error = new Error(
    state.status !== 'active' || state.plan === 'suspended'
      ? 'A IA desta guilda está suspensa.'
      : 'A cota mensal de IA desta guilda acabou.',
  );
  error.code = 'AI_QUOTA';
  error.status = 402;
  throw error;
}

function reserveUsage({ guildId, userId, operation, requestId }) {
  const entitlement = assertEntitlement(guildId);
  insertUsageEvent({
    requestId,
    guildId,
    userId,
    operation,
    status: 'reserved',
  });
  return { requestId, entitlement };
}

function commitUsage(event) {
  insertUsageEvent({ ...event, status: 'ok' });
}

function rollbackUsage({ requestId, guildId, userId, operation, status = 'error' }) {
  insertUsageEvent({
    requestId,
    guildId,
    userId,
    operation,
    status,
  });
}

function usageSummary(guildId) {
  const entitlement = getEntitlementState(guildId);
  return {
    entitlement,
    daily: listUsageDaily(guildId),
  };
}

module.exports = {
  newRequestId,
  getEntitlementState,
  assertEntitlement,
  reserveUsage,
  commitUsage,
  rollbackUsage,
  usageSummary,
};
