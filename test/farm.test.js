const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coroa-farm-'));
process.env.DATABASE_PATH = path.join(tmp, 'farm.sqlite');
process.env.BACKUP_PATH = path.join(tmp, 'backups');
process.chdir(path.resolve(__dirname, '..'));

const {
  addMaterial,
  insertEntry,
  getEntry,
  setEntryStatus,
  withTransaction,
  insertAuditEvent,
  backupDatabase,
} = require('../src/db');
const { isLeader, isManager, isMember } = require('../src/permissions');

describe('farm e permissões', () => {
  const guildId = 'guild-test';

  it('distingue líder, gerente e membro', () => {
    const settings = {
      leader_role_id: '10',
      manager_role_id: '20',
      member_role_id: '30',
    };
    const member = (roles, admin = false) => ({
      permissions: { has: () => admin },
      roles: { cache: { has: (id) => roles.includes(id) } },
    });
    assert.equal(isLeader(member([], true), settings), true);
    assert.equal(isLeader(member(['10']), settings), true);
    assert.equal(isLeader(member(['20']), settings), false);
    assert.equal(isManager(member(['20']), settings), true);
    assert.equal(isMember(member(['30']), settings), true);
    assert.equal(isMember(member([]), settings), false);
  });

  it('não duplica lançamento recente e é idempotente na validação', () => {
    addMaterial(guildId, 'Maconha');
    const first = insertEntry({
      guildId,
      userId: 'u1',
      userTag: 'u#1',
      material: 'maconha',
      quantity: 10,
      note: null,
    });
    const second = insertEntry({
      guildId,
      userId: 'u1',
      userTag: 'u#1',
      material: 'maconha',
      quantity: 10,
      note: null,
    });
    assert.equal(second.duplicate, true);
    assert.equal(second.id, first.id);
    const approved = withTransaction(() => {
      const row = setEntryStatus(guildId, first.id, 'approved', 'staff');
      insertAuditEvent({
        guildId,
        actorId: 'staff',
        action: 'farm.approved',
        targetId: String(first.id),
      });
      return row;
    });
    assert.equal(approved.status, 'approved');
    const again = setEntryStatus(guildId, first.id, 'approved', 'staff');
    assert.equal(again.id, approved.id);
    assert.ok(getEntry(guildId, first.id));
  });

  it('cria backup do sqlite', async () => {
    const dest = await backupDatabase();
    assert.equal(fs.existsSync(dest), true);
    assert.ok(fs.statSync(dest).size > 0);
  });
});
