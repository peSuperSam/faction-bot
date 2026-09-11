const { AuditLogEvent, EmbedBuilder } = require('discord.js');
const {
  getSettings,
  insertMemberEvent,
  findRecentMemberEvent,
  insertAuditEvent,
} = require('./db');
const { truncate } = require('./util');

const TRACKED = [
  ['leader_role_id', 'líder'],
  ['manager_role_id', 'gerente'],
  ['member_role_id', 'membro'],
];

function userTag(user) {
  return user?.tag || user?.globalName || user?.username || user?.id || 'desconhecido';
}

function trackedRoleIds(settings) {
  return TRACKED.map(([key, label]) => ({
    id: settings[key],
    label,
  })).filter((item) => item.id);
}

async function sendMemberLog(client, guildId, title, description) {
  const settings = getSettings(guildId);
  if (!settings.log_channel_id) {
    return;
  }
  try {
    const channel = await client.channels.fetch(settings.log_channel_id);
    if (!channel?.isTextBased()) {
      return;
    }
    await channel.send({
      allowedMentions: { parse: [] },
      embeds: [
        new EmbedBuilder()
          .setColor(0xc9a227)
          .setTitle(title)
          .setDescription(truncate(description, 1800))
          .setTimestamp()
          .setFooter({ text: 'Coroa • Membros' }),
      ],
    });
  } catch (error) {
    console.error('Falha ao enviar log de membro:', error.message);
  }
}

function persist(event) {
  const id = insertMemberEvent(event);
  insertAuditEvent({
    guildId: event.guildId,
    actorId: event.actorId || event.userId,
    action: `member.${event.type}`,
    targetId: event.userId,
    detail: event.detail,
  });
  return id;
}

async function classifyDeparture(guild, user) {
  try {
    const [kicks, bans] = await Promise.all([
      guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 5 }),
      guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 5 }),
    ]);
    const ban = [...bans.entries.values()].find(
      (entry) =>
        entry.target?.id === user.id && Date.now() - entry.createdTimestamp < 12_000,
    );
    if (ban) {
      return {
        type: 'ban',
        actorId: ban.executor?.id || null,
        detail: ban.reason || 'Banido',
        certainty: 'known',
      };
    }
    const kick = [...kicks.entries.values()].find(
      (entry) =>
        entry.target?.id === user.id && Date.now() - entry.createdTimestamp < 12_000,
    );
    if (kick) {
      return {
        type: 'kick',
        actorId: kick.executor?.id || null,
        detail: kick.reason || 'Expulso',
        certainty: 'known',
      };
    }
    return {
      type: 'leave',
      actorId: null,
      detail: 'Saiu do servidor',
      certainty: 'known',
    };
  } catch {
    return {
      type: 'leave',
      actorId: null,
      detail: 'Saiu ou foi removido',
      certainty: 'uncertain',
    };
  }
}

function registerMemberEventListeners(client) {
  client.on('guildMemberAdd', async (member) => {
    try {
      persist({
        guildId: member.guild.id,
        userId: member.id,
        userTag: userTag(member.user),
        type: 'join',
        detail: 'Entrou no servidor',
      });
      await sendMemberLog(
        client,
        member.guild.id,
        'Membro entrou',
        `**${userTag(member.user)}** (<@${member.id}>) entrou no servidor.`,
      );
    } catch (error) {
      console.error('Falha ao registrar entrada:', error.message);
    }
  });

  client.on('guildMemberRemove', async (member) => {
    try {
      const alreadyBan = findRecentMemberEvent({
        guildId: member.guild.id,
        userId: member.id,
        type: 'ban',
        seconds: 15,
      });
      if (alreadyBan) {
        return;
      }
      const classified = await classifyDeparture(member.guild, member.user);
      persist({
        guildId: member.guild.id,
        userId: member.id,
        userTag: userTag(member.user),
        type: classified.type,
        actorId: classified.actorId,
        detail: classified.detail,
        certainty: classified.certainty,
      });
      const titles = {
        leave: 'Membro saiu',
        kick: 'Membro expulso',
        ban: 'Membro banido',
      };
      await sendMemberLog(
        client,
        member.guild.id,
        titles[classified.type] || 'Membro saiu',
        `**${userTag(member.user)}** (<@${member.id}>): ${classified.detail}${
          classified.certainty === 'uncertain' ? ' (sem confirmação no Audit Log)' : ''
        }`,
      );
    } catch (error) {
      console.error('Falha ao registrar saída:', error.message);
    }
  });

  client.on('guildBanAdd', async (ban) => {
    try {
      const existing = findRecentMemberEvent({
        guildId: ban.guild.id,
        userId: ban.user.id,
        type: 'ban',
        seconds: 15,
      });
      if (existing) {
        return;
      }
      persist({
        guildId: ban.guild.id,
        userId: ban.user.id,
        userTag: userTag(ban.user),
        type: 'ban',
        detail: ban.reason || 'Banido',
      });
      await sendMemberLog(
        client,
        ban.guild.id,
        'Membro banido',
        `**${userTag(ban.user)}** (<@${ban.user.id}>) foi banido.`,
      );
    } catch (error) {
      console.error('Falha ao registrar ban:', error.message);
    }
  });

  client.on('guildBanRemove', async (ban) => {
    try {
      persist({
        guildId: ban.guild.id,
        userId: ban.user.id,
        userTag: userTag(ban.user),
        type: 'unban',
        detail: 'Ban removido',
      });
      await sendMemberLog(
        client,
        ban.guild.id,
        'Ban removido',
        `**${userTag(ban.user)}** (<@${ban.user.id}>) teve o ban removido.`,
      );
    } catch (error) {
      console.error('Falha ao registrar unban:', error.message);
    }
  });

  client.on('guildMemberUpdate', async (before, after) => {
    try {
      const settings = getSettings(after.guild.id);
      const tracked = trackedRoleIds(settings);
      if (!tracked.length) {
        return;
      }
      const had = new Set(before.roles.cache.keys());
      const has = new Set(after.roles.cache.keys());
      for (const role of tracked) {
        const beforeHad = had.has(role.id);
        const afterHas = has.has(role.id);
        if (beforeHad === afterHas) {
          continue;
        }
        const type = afterHas ? 'role_add' : 'role_remove';
        persist({
          guildId: after.guild.id,
          userId: after.id,
          userTag: userTag(after.user),
          type,
          roleId: role.id,
          detail: afterHas
            ? `Recebeu o cargo de ${role.label}`
            : `Perdeu o cargo de ${role.label}`,
        });
        await sendMemberLog(
          client,
          after.guild.id,
          afterHas ? 'Cargo concedido' : 'Cargo removido',
          `**${userTag(after.user)}** (<@${after.id}>) ${
            afterHas ? 'recebeu' : 'perdeu'
          } o cargo de **${role.label}**.`,
        );
      }
    } catch (error) {
      console.error('Falha ao registrar cargo:', error.message);
    }
  });
}

module.exports = {
  registerMemberEventListeners,
  classifyDeparture,
  persistMemberEvent: persist,
};
