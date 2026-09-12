const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coroa-authz-'));
process.env.DATABASE_PATH = path.join(tmp, 'farm.sqlite');
process.env.WEB_DEV_USER_IDS = 'dev-1';

const { resolveAccess, assertRole } = require('../src/web-authz');

const ADMIN_PERM = '8';
const MANAGE_GUILD_PERM = '32';

describe('autorização web', () => {
  const settings = {
    guild_id: 'g1',
    leader_role_id: '10',
    manager_role_id: '20',
    member_role_id: '30',
  };

  it('reconhece líder, gerente, membro e desenvolvedor', () => {
    const leader = resolveAccess({
      userId: 'u-lead',
      member: { user: { id: 'u-lead' }, roles: ['10'] },
      settings,
    });
    assert.equal(leader.role, 'leader');
    assert.equal(leader.isLeader, true);

    const manager = resolveAccess({
      userId: 'u-man',
      member: { user: { id: 'u-man' }, roles: ['20'] },
      settings,
    });
    assert.equal(manager.role, 'manager');
    assert.equal(manager.isLeader, false);

    const member = resolveAccess({
      userId: 'u-mem',
      member: { user: { id: 'u-mem' }, roles: ['30'] },
      settings,
    });
    assert.equal(member.role, 'member');
    assert.equal(member.canOpenPanel, false);

    const developer = resolveAccess({
      userId: 'dev-1',
      member: null,
      settings,
    });
    assert.equal(developer.role, 'developer');
    assert.equal(developer.isLeader, true);
    assert.equal(developer.canOpenPanel, true);
  });

  it('só dono, Administrador, Gerenciar servidor ou dev abrem o painel', () => {
    const member = resolveAccess({
      userId: 'u-mem',
      member: { user: { id: 'u-mem' }, roles: ['30'] },
      settings,
    });
    assert.equal(member.canOpenPanel, false);

    const owner = resolveAccess({
      userId: 'u-own',
      member: { user: { id: 'u-own' }, roles: ['30'] },
      guild: { id: 'g1', owner_id: 'u-own' },
      settings,
    });
    assert.equal(owner.canOpenPanel, true);

    const discordAdmin = resolveAccess({
      userId: 'u-adm',
      member: { user: { id: 'u-adm' }, roles: ['99'] },
      roles: [{ id: '99', permissions: ADMIN_PERM }],
      settings,
    });
    assert.equal(discordAdmin.canOpenPanel, true);

    const managerGuild = resolveAccess({
      userId: 'u-mg',
      member: { user: { id: 'u-mg' }, roles: ['98'] },
      roles: [{ id: '98', permissions: MANAGE_GUILD_PERM }],
      settings,
    });
    assert.equal(managerGuild.canOpenPanel, true);
  });

  it('bloqueia cargo insuficiente', () => {
    const member = resolveAccess({
      userId: 'u-mem',
      member: { user: { id: 'u-mem' }, roles: ['30'] },
      settings,
    });
    assert.throws(() => assertRole(member, 'leader'), (error) => error.status === 403);
  });
});
