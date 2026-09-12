const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coroa-web-svc-'));
process.env.DATABASE_PATH = path.join(tmp, 'farm.sqlite');
process.env.BACKUP_PATH = path.join(tmp, 'backups');
process.chdir(path.resolve(__dirname, '..'));

const { addMaterial, insertEntry, insertMemberEvent, listMemberEvents } = require('../src/db');
const {
  getDashboard,
  saveGoals,
  reviewEntry,
  correctEntry,
  removeEntry,
  getMembersPage,
} = require('../src/web-services');

describe('serviços do painel', () => {
  const guildId = 'guild-web';
  const actor = { userId: 'staff', tag: 'staff#1' };
  const silent = {
    sendMessage: async () => ({ id: 'x' }),
    editMessage: async () => ({ id: 'x' }),
  };

  it('monta dashboard e opera farm com auditoria', () => {
    const material = addMaterial(guildId, 'Maconha');
    const created = insertEntry({
      guildId,
      userId: 'u1',
      userTag: 'u#1',
      material: material.name,
      quantity: 5,
      note: null,
      status: 'pending',
    });
    saveGoals(guildId, actor, [{ material: material.name, quantity: 40 }], silent);
    const dash = getDashboard(guildId);
    assert.equal(dash.goals[0].quantity, 40);
    assert.equal(dash.pendingCount, 1);
    reviewEntry(guildId, actor, created.id, 'approved', silent);
    correctEntry(
      guildId,
      actor,
      created.id,
      { quantity: 8, reason: 'ajuste' },
      silent,
    );
    removeEntry(guildId, actor, created.id, 'teste', silent);
    const after = getDashboard(guildId);
    assert.equal(after.pendingCount, 0);
  });

  it('persiste evento de membro', () => {
    insertMemberEvent({
      guildId,
      userId: 'u2',
      userTag: 'u#2',
      type: 'join',
      detail: 'Entrou no servidor',
    });
    const events = listMemberEvents({ guildId, limit: 5 });
    assert.equal(events[0].type, 'join');
  });

  it('traz cargos e avatar reais do Discord na lista de membros', async () => {
    const discord = {
      fetchRoles: async () => [
        { id: 'guild-web', name: '@everyone', position: 0, color: 0 },
        { id: '10', name: 'Líder', position: 8, color: 16766720 },
        { id: '55', name: 'Staff', position: 4, color: 3447003 },
      ],
      listMembers: async () => [
        {
          nick: 'SuperSam',
          avatar: null,
          joined_at: '2026-09-07T00:09:12.497Z',
          roles: ['10', '55', 'guild-web'],
          user: {
            id: 'u-lead',
            username: 'sam',
            global_name: 'SuperSam',
            avatar: 'facehash',
            bot: false,
          },
        },
      ],
    };
    const page = await getMembersPage(guildId, discord);
    assert.equal(page.members[0].tag, 'SuperSam');
    assert.deepEqual(
      page.members[0].roles.map((role) => role.name),
      ['Líder', 'Staff'],
    );
    assert.match(page.members[0].avatar, /avatars\/u-lead\/facehash/);
    assert.doesNotMatch(page.members[0].joinedAt, /T00:09/);
  });
});
