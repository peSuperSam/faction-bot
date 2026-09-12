const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coroa-isolation-'));
process.env.DATABASE_PATH = path.join(tmp, 'farm.sqlite');
process.env.RULES_PATH = path.join(tmp, 'rules');
process.env.BACKUP_PATH = path.join(tmp, 'backups');
process.chdir(path.resolve(__dirname, '..'));
fs.cpSync(path.resolve('rules'), process.env.RULES_PATH, { recursive: true });

const { replaceKnowledge, searchKnowledge, setEntitlement, countUsageThisMonth } = require('../src/db');
const { reloadKnowledge, searchRules, listKnowledgeDocuments } = require('../src/knowledge');
const { chunkText } = require('../src/knowledge-util');
const documents = require('../src/documents');
const {
  reserveUsage,
  commitUsage,
  rollbackUsage,
  getEntitlementState,
} = require('../src/ai-entitlement');
const { processBillingEvent, applySubscriptionToGuild } = require('../src/billing');
const { initializeGuild, deactivateGuild } = require('../src/guild-lifecycle');
const { validateStartupEnv } = require('../src/startup');

function doc(name, content) {
  return {
    name,
    version: 1,
    hash: name,
    chunks: chunkText(content),
  };
}

describe('isolamento multi-guild e data-driven', () => {
  before(() => {
    reloadKnowledge();
  });

  it('onboarding de guilda é idempotente e não apaga dados ao sair', async () => {
    const first = await initializeGuild(null, { id: 'guild-a', name: 'Alpha', ownerId: 'o1' });
    const second = await initializeGuild(null, { id: 'guild-a', name: 'Alpha 2', ownerId: 'o1' });
    assert.equal(first.guild_id, 'guild-a');
    assert.equal(second.guild_id, 'guild-a');
    const inactive = deactivateGuild('guild-a');
    assert.equal(inactive.status, 'inactive');
    await initializeGuild(null, { id: 'guild-a', name: 'Alpha', ownerId: 'o1' });
  });

  it('documento da guilda A não aparece na busca da guilda B', () => {
    replaceKnowledge(
      [doc('segredo-a.md', '## Segredo\n\nO codigo secreto da guilda A e abacateazulunico nas regras internas.')],
      { guildId: 'guild-a', scope: 'guild' },
    );
    replaceKnowledge(
      [doc('publico-b.md', '## Publico\n\nA guilda B so fala de laranjadoce99 nas regras internas.')],
      { guildId: 'guild-b', scope: 'guild' },
    );
    assert.ok(listKnowledgeDocuments('guild-a').some((row) => row.name === 'segredo-a.md'));
    assert.equal(
      listKnowledgeDocuments('guild-b').some((row) => row.name === 'segredo-a.md'),
      false,
    );
    const hitsA = searchRules('abacateazulunico', 4, 'guild-a');
    const hitsB = searchRules('abacateazulunico', 4, 'guild-b');
    assert.ok(hitsA.some((row) => row.document_name === 'segredo-a.md'));
    assert.equal(
      hitsB.some((row) => row.document_name === 'segredo-a.md'),
      false,
    );
    const leaked = searchKnowledge('abacateazulunico', 20, 'guild-b');
    assert.equal(
      leaked.some((row) => row.document_name === 'segredo-a.md'),
      false,
    );
  });

  it('reload global não apaga documentos da guilda', () => {
    const before = listKnowledgeDocuments('guild-a').map((row) => row.name);
    assert.ok(before.includes('segredo-a.md'));
    const reloaded = reloadKnowledge();
    assert.equal(Boolean(reloaded.aborted), false);
    const after = listKnowledgeDocuments('guild-a').map((row) => row.name);
    assert.ok(after.includes('segredo-a.md'));
    const globalOnly = listKnowledgeDocuments().map((row) => row.name);
    assert.equal(globalOnly.includes('segredo-a.md'), false);
  });

  it('publica documento versionado e isola o índice', () => {
    const actor = { userId: 'lead-a' };
    const created = documents.createDocument('guild-a', actor, {
      title: 'Regra local',
      slug: 'regra-local',
      content: '## Local\n\nA guilda A usa o termo kiwinativo nas regras internas.',
    });
    const published = documents.publishDocuments('guild-a', actor, {
      documentIds: [created.document.id],
      message: 'release inicial',
    });
    assert.equal(published.ok, true);
    const hitsA = searchRules('kiwinativo', 4, 'guild-a');
    const hitsB = searchRules('kiwinativo', 4, 'guild-b');
    assert.ok(hitsA.some((row) => String(row.document_name).includes('regra-local')));
    assert.equal(
      hitsB.some((row) => String(row.document_name).includes('regra-local')),
      false,
    );
  });

  it('cota de IA é por guilda e idempotente no request_id', () => {
    setEntitlement('guild-a', { plan: 'free', monthlyLimit: 1, status: 'active', source: 'manual' });
    setEntitlement('guild-b', { plan: 'free', monthlyLimit: 1, status: 'active', source: 'manual' });
    reserveUsage({ guildId: 'guild-a', userId: 'u1', operation: 'question', requestId: 'req-1' });
    commitUsage({ requestId: 'req-1', guildId: 'guild-a', userId: 'u1', operation: 'question' });
    commitUsage({ requestId: 'req-1', guildId: 'guild-a', userId: 'u1', operation: 'question' });
    assert.equal(countUsageThisMonth('guild-a'), 1);
    assert.equal(getEntitlementState('guild-a').allowed, false);
    assert.throws(
      () => reserveUsage({ guildId: 'guild-a', userId: 'u1', operation: 'question', requestId: 'req-2' }),
      (error) => error.code === 'AI_QUOTA',
    );
    reserveUsage({ guildId: 'guild-b', userId: 'u2', operation: 'question', requestId: 'req-3' });
    rollbackUsage({ requestId: 'req-3', guildId: 'guild-b', userId: 'u2', operation: 'question' });
    assert.equal(getEntitlementState('guild-b').allowed, true);
  });

  it('evento de billing é idempotente e atualiza entitlement', () => {
    const first = processBillingEvent({
      provider: 'future',
      externalEventId: 'evt-1',
      eventType: 'invoice.paid',
      payload: { ok: true },
    });
    const second = processBillingEvent({
      provider: 'future',
      externalEventId: 'evt-1',
      eventType: 'invoice.paid',
      payload: { ok: true },
    });
    assert.equal(first.accepted, true);
    assert.equal(second.duplicate, true);
    const entitlement = applySubscriptionToGuild('guild-a', {
      plan: 'pro',
      status: 'active',
      periodStart: '2026-01-01',
      periodEnd: '2026-02-01',
    });
    assert.equal(entitlement.plan, 'pro');
    assert.equal(entitlement.monthly_limit, 2000);
  });
});

describe('startup multi-guild', () => {
  it('aceita ausência de DISCORD_GUILD_ID', () => {
    const previous = {
      DISCORD_TOKEN: process.env.DISCORD_TOKEN,
      DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
      DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
    };
    process.env.DISCORD_TOKEN = 'token';
    process.env.DISCORD_CLIENT_ID = 'client';
    process.env.DISCORD_GUILD_ID = '';
    const result = validateStartupEnv();
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some((item) => /DISCORD_GUILD_ID/.test(item)));
    process.env.DISCORD_TOKEN = previous.DISCORD_TOKEN;
    process.env.DISCORD_CLIENT_ID = previous.DISCORD_CLIENT_ID;
    process.env.DISCORD_GUILD_ID = previous.DISCORD_GUILD_ID;
  });
});
