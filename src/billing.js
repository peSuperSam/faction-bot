const crypto = require('node:crypto');
const { recordBillingEvent, getEntitlement, setEntitlement } = require('./db');
const { getEntitlementState, reserveUsage, commitUsage, rollbackUsage } = require('./ai-entitlement');

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
}

function processBillingEvent({ provider, externalEventId, eventType, payload }) {
  const accepted = recordBillingEvent({
    provider,
    externalEventId,
    eventType,
    payloadHash: hashPayload(payload),
  });
  return { accepted, duplicate: !accepted };
}

function applySubscriptionToGuild(guildId, { plan, status, periodStart, periodEnd }) {
  const limits = {
    free: 50,
    pro: 2000,
    internal: 0,
    suspended: 0,
  };
  return setEntitlement(guildId, {
    plan: plan || getEntitlement(guildId).plan,
    status: status || 'active',
    monthlyLimit: limits[plan] ?? getEntitlement(guildId).monthly_limit,
    source: 'billing',
    startsAt: periodStart || null,
    endsAt: periodEnd || null,
  });
}

module.exports = {
  getEntitlement: getEntitlementState,
  reserveUsage,
  commitUsage,
  rollbackUsage,
  processBillingEvent,
  applySubscriptionToGuild,
};
