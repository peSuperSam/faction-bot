const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coroa-web-api-'));
process.env.DATABASE_PATH = path.join(tmp, 'farm.sqlite');
process.env.BACKUP_PATH = path.join(tmp, 'backups');
process.env.WEB_API_SECRET = 'service-secret';
process.env.SESSION_SECRET = 'session-secret';
process.env.DISCORD_GUILD_ID = 'guild-api';
process.env.WEB_DEV_USER_IDS = 'dev-1';
process.env.ROLE_LEADER_ID = '10001';
process.env.ROLE_MANAGER_ID = '20002';
process.env.ROLE_MEMBER_ID = '30003';
process.chdir(path.resolve(__dirname, '..'));

const { addMaterial } = require('../src/db');
const { signSession } = require('../src/web-session');
const { createWebHandler, resetRateLimitForTests } = require('../src/web-api');

const ADMIN_PERM = '8';

function discordFor(userId, roleIds, options = {}) {
  const guildId = options.guildId || 'guild-api';
  const ownerId = options.ownerId || 'owner';
  const botGuilds = options.botGuilds || [
    { id: guildId, name: options.guildName || 'Facção', icon: null },
  ];
  const missing = new Set(options.missingMembers || []);
  return {
    fetchMember: async (gid, uid) => {
      if (missing.has(`${gid}:${uid}`) || missing.has(uid)) {
        const error = new Error('Unknown Member');
        error.status = 404;
        throw error;
      }
      if (options.fetchMember) {
        return options.fetchMember(gid, uid);
      }
      return {
        user: { id: uid, username: uid },
        roles: uid === userId ? roleIds : [],
      };
    },
    fetchRoles: async () =>
      options.fetchRoles
        ? options.fetchRoles()
        : [
            { id: '10001', permissions: '0' },
            { id: '20002', permissions: '0' },
            { id: '30003', permissions: '0' },
            { id: 'admin-role', permissions: options.adminRolePerm || '0' },
          ],
    fetchGuild: async (gid) => ({
      id: gid,
      name: options.names?.[gid] || options.guildName || 'Facção',
      owner_id: options.owners?.[gid] || ownerId,
      icon: null,
    }),
    listBotGuilds: async () => botGuilds,
    listMembers: async () => [],
    sendMessage: async () => ({ id: 'msg' }),
    editMessage: async () => ({ id: 'msg' }),
  };
}

async function withServer(discord, fn) {
  resetRateLimitForTests();
  const server = http.createServer(createWebHandler({ discord }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function call(port, { method = 'GET', path: urlPath, userId, guildId, session, body }) {
  const headers = {
    'X-Coroa-Service': 'service-secret',
  };
  if (userId) {
    headers['X-Coroa-User-Id'] = userId;
  }
  if (guildId) {
    headers['X-Coroa-Guild-Id'] = guildId;
  }
  if (session) {
    headers['X-Coroa-Session'] = session;
  }
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json() };
}

describe('API web', () => {
  before(() => {
    addMaterial('guild-api', 'Maconha');
    addMaterial('guild-a', 'Maconha');
  });

  it('exige segredo de serviço', async () => {
    await withServer(discordFor('u-lead', ['10001'], { ownerId: 'u-lead' }), async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/v1/dashboard`);
      assert.equal(response.status, 401);
    });
  });

  it('recusa membro da facção sem Administrador', async () => {
    await withServer(discordFor('u-mem', ['30003']), async (port) => {
      const dash = await call(port, {
        path: '/v1/dashboard',
        userId: 'u-mem',
        guildId: 'guild-api',
      });
      assert.equal(dash.status, 403);
      const settings = await call(port, {
        method: 'PATCH',
        path: '/v1/settings',
        userId: 'u-mem',
        guildId: 'guild-api',
        body: { auto_approve: false },
      });
      assert.equal(settings.status, 403);
    });
  });

  it('pede seleção de servidor quando a sessão não tem guilda', async () => {
    await withServer(discordFor('u-admin', ['admin-role'], { adminRolePerm: ADMIN_PERM }), async (port) => {
      const dash = await call(port, { path: '/v1/dashboard', userId: 'u-admin' });
      assert.equal(dash.status, 409);
      const me = await call(port, { path: '/v1/me', userId: 'u-admin' });
      assert.equal(me.status, 200);
      assert.equal(me.json.needsGuild, true);
    });
  });

  it('admin lista e seleciona só guildas em que o bot está', async () => {
    const discord = discordFor('u-admin', [], {
      ownerId: 'other',
      botGuilds: [
        { id: 'guild-a', name: 'Facção A', icon: null },
        { id: 'guild-bot-only', name: 'Outro bot', icon: null },
      ],
      owners: { 'guild-a': 'u-admin', 'guild-bot-only': 'other' },
      names: { 'guild-a': 'Facção A', 'guild-bot-only': 'Outro bot' },
    });
    await withServer(discord, async (port) => {
      const listed = await call(port, { path: '/v1/guilds', userId: 'u-admin' });
      assert.equal(listed.status, 200);
      assert.deepEqual(
        listed.json.guilds.map((guild) => guild.id),
        ['guild-a'],
      );

      const selected = await call(port, {
        method: 'POST',
        path: '/v1/guilds/select',
        userId: 'u-admin',
        body: { guildId: 'guild-a' },
      });
      assert.equal(selected.status, 200);
      assert.equal(selected.json.guild.id, 'guild-a');

      const deniedBotMissing = await call(port, {
        method: 'POST',
        path: '/v1/guilds/select',
        userId: 'u-admin',
        body: { guildId: 'guild-admin-only' },
      });
      assert.equal(deniedBotMissing.status, 403);

      const deniedNotAdmin = await call(port, {
        method: 'POST',
        path: '/v1/guilds/select',
        userId: 'u-admin',
        body: { guildId: 'guild-bot-only' },
      });
      assert.equal(deniedNotAdmin.status, 403);
    });
  });

  it('depois de selecionar, o dashboard usa aquela guilda', async () => {
    const discord = discordFor('u-admin', ['admin-role'], {
      adminRolePerm: ADMIN_PERM,
      guildId: 'guild-a',
      botGuilds: [{ id: 'guild-a', name: 'Facção A', icon: null }],
      guildName: 'Facção A',
    });
    await withServer(discord, async (port) => {
      const session = signSession({
        sub: 'u-admin',
        tag: 'Admin',
        guildId: 'guild-a',
      });
      const me = await call(port, { path: '/v1/me', session });
      assert.equal(me.status, 200);
      assert.equal(me.json.guild.id, 'guild-a');
      assert.equal(me.json.needsGuild, false);
      const dash = await call(port, { path: '/v1/dashboard', session });
      assert.equal(dash.status, 200);
      assert.ok(dash.json.period);
    });
  });

  it('desenvolvedor vê as guildas do bot mesmo sem ser admin', async () => {
    const discord = discordFor('dev-1', [], {
      missingMembers: ['dev-1'],
      botGuilds: [
        { id: 'guild-api', name: 'Facção', icon: null },
        { id: 'guild-b', name: 'Segunda', icon: null },
      ],
    });
    await withServer(discord, async (port) => {
      const listed = await call(port, { path: '/v1/guilds', userId: 'dev-1' });
      assert.equal(listed.status, 200);
      assert.deepEqual(
        listed.json.guilds.map((guild) => guild.id).sort(),
        ['guild-api', 'guild-b'],
      );
      const me = await call(port, { path: '/v1/me', userId: 'dev-1' });
      assert.equal(me.status, 200);
      assert.equal(me.json.user.role, 'developer');
      const dash = await call(port, {
        path: '/v1/dashboard',
        userId: 'dev-1',
        guildId: 'guild-api',
      });
      assert.equal(dash.status, 200);
    });
  });

  it('líder administrador altera meta', async () => {
    await withServer(
      discordFor('u-lead', ['10001'], { ownerId: 'u-lead' }),
      async (port) => {
        const saved = await call(port, {
          method: 'POST',
          path: '/v1/farm/goals',
          userId: 'u-lead',
          guildId: 'guild-api',
          body: { goals: [{ material: 'maconha', quantity: 25 }] },
        });
        assert.equal(saved.status, 200);
        assert.equal(saved.json.ok, true);
      },
    );
  });

  it('documentos e entitlement ficam na guilda da sessão', async () => {
    const discord = discordFor('u-admin', ['admin-role'], {
      adminRolePerm: ADMIN_PERM,
      ownerId: 'u-admin',
      botGuilds: [
        { id: 'guild-api', name: 'Facção', icon: null },
        { id: 'guild-a', name: 'Facção A', icon: null },
      ],
    });
    await withServer(discord, async (port) => {
      const created = await call(port, {
        method: 'POST',
        path: '/v1/documents',
        userId: 'u-admin',
        guildId: 'guild-api',
        body: {
          title: 'Local API',
          slug: 'local-api',
          content: '## Teste\n\nDocumento exclusivo da guild-api com termo zinnia-77.',
        },
      });
      assert.equal(created.status, 200);
      const published = await call(port, {
        method: 'POST',
        path: '/v1/documents/publish',
        userId: 'u-admin',
        guildId: 'guild-api',
        body: { documentIds: [created.json.document.id] },
      });
      assert.equal(published.status, 200);
      assert.equal(published.json.ok, true);

      const otherList = await call(port, {
        path: '/v1/documents',
        userId: 'u-admin',
        guildId: 'guild-a',
      });
      assert.equal(otherList.status, 200);
      assert.equal(
        (otherList.json.documents || []).some((doc) => doc.slug === 'local-api'),
        false,
      );

      const entitlements = await call(port, {
        path: '/v1/ai/entitlements',
        userId: 'u-admin',
        guildId: 'guild-api',
      });
      assert.equal(entitlements.status, 200);
      assert.equal(entitlements.json.guildId, 'guild-api');
      assert.equal(entitlements.json.plan, 'internal');
    });
  });
});
