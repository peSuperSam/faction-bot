const { PermissionFlagsBits } = require('discord.js');

const STAFF_ALLOW = {
  ViewChannel: true,
  SendMessages: true,
  ReadMessageHistory: true,
  EmbedLinks: true,
  AttachFiles: true,
  ManageMessages: true,
  UseApplicationCommands: true,
};

const BOT_ALLOW = {
  ...STAFF_ALLOW,
  ManageChannels: true,
  ManageNicknames: true,
};

const HIDDEN = {
  ViewChannel: false,
  SendMessages: false,
};

async function applyAdminChannelPermissions(channel, settings) {
  const notes = [];
  const me = channel.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return {
      ok: false,
      message:
        'O Coroa precisa da permissão **Gerenciar canais** para travar este chat sozinho. Marque isso no cargo do bot.',
    };
  }

  try {
    await channel.permissionOverwrites.edit(channel.guild.roles.everyone, HIDDEN);
  } catch {
    return {
      ok: false,
      message:
        'Não consegui esconder o canal do @everyone. Suba o cargo do Coroa e confirme **Gerenciar canais**.',
    };
  }

  try {
    await channel.permissionOverwrites.edit(me, BOT_ALLOW);
  } catch {
    notes.push('Não consegui garantir as permissões do Coroa neste canal.');
  }

  const staffRoles = [
    ['líder', settings.leader_role_id],
    ['gerente', settings.manager_role_id],
  ];
  const granted = new Set();
  for (const [label, roleId] of staffRoles) {
    if (!roleId || granted.has(roleId)) {
      continue;
    }
    granted.add(roleId);
    const role = channel.guild.roles.cache.get(roleId);
    if (!role) {
      notes.push(`Cargo de ${label} configurado não foi encontrado.`);
      continue;
    }
    try {
      await channel.permissionOverwrites.edit(role, STAFF_ALLOW);
    } catch {
      notes.push(
        `Não consegui liberar o cargo de ${label}. O cargo do Coroa precisa ficar acima dele.`,
      );
    }
  }

  if (settings.member_role_id && !granted.has(settings.member_role_id)) {
    try {
      await channel.permissionOverwrites.edit(settings.member_role_id, HIDDEN);
    } catch {
      // ignore
    }
  }

  if (!settings.leader_role_id && !settings.manager_role_id) {
    notes.push(
      'Defina os cargos de líder e gerente nas configurações do servidor para o Coroa liberar esses cargos neste canal.',
    );
  }

  return { ok: true, notes };
}

module.exports = { applyAdminChannelPermissions };
