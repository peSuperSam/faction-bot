const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coroa-members-'));
process.env.DATABASE_PATH = path.join(tmp, 'farm.sqlite');
process.chdir(path.resolve(__dirname, '..'));

const { AuditLogEvent } = require('discord.js');
const { listMemberEvents } = require('../src/db');
const { classifyDeparture, persistMemberEvent } = require('../src/member-events');

describe('eventos de membros', () => {
  it('classifica kick pelo audit log e deixa incerteza se a consulta falhar', async () => {
    const guild = {
      fetchAuditLogs: async ({ type }) => {
        if (type === AuditLogEvent.MemberKick) {
          return {
            entries: new Map([
              [
                '1',
                {
                  target: { id: 'u1' },
                  executor: { id: 'mod' },
                  reason: 'spam',
                  createdTimestamp: Date.now(),
                },
              ],
            ]),
          };
        }
        return { entries: new Map() };
      },
    };
    const kicked = await classifyDeparture(guild, { id: 'u1' });
    assert.equal(kicked.type, 'kick');
    assert.equal(kicked.certainty, 'known');

    const uncertain = await classifyDeparture(
      {
        fetchAuditLogs: async () => {
          throw new Error('Missing Access');
        },
      },
      { id: 'u1' },
    );
    assert.equal(uncertain.certainty, 'uncertain');
  });

  it('grava evento sem o objeto completo do membro', () => {
    persistMemberEvent({
      guildId: 'g1',
      userId: 'u9',
      userTag: 'nome',
      type: 'leave',
      detail: 'Saiu ou foi removido',
      certainty: 'uncertain',
    });
    const [row] = listMemberEvents({ guildId: 'g1', limit: 1 });
    assert.equal(row.type, 'leave');
    assert.equal(row.certainty, 'uncertain');
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'user'), false);
  });
});
