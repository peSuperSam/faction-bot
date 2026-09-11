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
});
