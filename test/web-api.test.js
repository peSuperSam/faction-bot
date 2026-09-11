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
const { createWebHandler, resetRateLimitForTests } = require('../src/web-api');

function discordFor(userId, roleIds) {
  return {
    fetchMember: async () => ({
      user: { id: userId, username: userId },
      roles: roleIds,
    }),
    fetchRoles: async () => [
      { id: '10001', permissions: '0' },
      { id: '20002', permissions: '0' },
      { id: '30003', permissions: '0' },
    ],
    fetchGuild: async () => ({ id: 'guild-api', owner_id: 'owner' }),
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

async function call(port, { method = 'GET', path, userId, body }) {
  const headers = {
    'X-Coroa-Service': 'service-secret',
    'X-Coroa-User-Id': userId,
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json() };
}

describe('API web', () => {
  before(() => {
    addMaterial('guild-api', 'Maconha');
  });

  it('exige segredo de serviço', async () => {
    await withServer(discordFor('u-lead', ['10001']), async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/v1/dashboard`);
      assert.equal(response.status, 401);
    });
  });

  it('permite dashboard ao membro e bloqueia configuração', async () => {
    await withServer(discordFor('u-mem', ['30003']), async (port) => {
      const dash = await call(port, { path: '/v1/dashboard', userId: 'u-mem' });
      assert.equal(dash.status, 200);
      assert.ok(dash.json.period);
      const denied = await call(port, {
        method: 'PATCH',
        path: '/v1/settings',
        userId: 'u-mem',
        body: { auto_approve: false },
      });
      assert.equal(denied.status, 403);
    });
  });

  it('líder altera meta e desenvolvedor acessa sem estar no servidor', async () => {
    await withServer(discordFor('u-lead', ['10001']), async (port) => {
      const saved = await call(port, {
        method: 'POST',
        path: '/v1/farm/goals',
        userId: 'u-lead',
        body: { goals: [{ material: 'maconha', quantity: 25 }] },
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.json.ok, true);
    });

    const discord = {
      ...discordFor('dev-1', []),
      fetchMember: async () => {
        const error = new Error('Unknown Member');
        error.status = 404;
        throw error;
      },
    };
    await withServer(discord, async (port) => {
      const me = await call(port, { path: '/v1/me', userId: 'dev-1' });
      assert.equal(me.status, 200);
      assert.equal(me.json.user.role, 'developer');
    });
  });
});
