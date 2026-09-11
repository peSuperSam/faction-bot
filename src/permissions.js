const { PermissionFlagsBits } = require('discord.js');
const { getSettings } = require('./db');
const { errorEmbed, ephemeral } = require('./embeds');

function isGuildAdmin(member) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

function hasRole(member, roleId) {
  return Boolean(roleId) && member.roles.cache.has(roleId);
}

function isLeader(member, settings) {
  return isGuildAdmin(member) || hasRole(member, settings.leader_role_id);
}

function isManager(member, settings) {
  return isLeader(member, settings) || hasRole(member, settings.manager_role_id);
}

function isMember(member, settings) {
  if (!settings.member_role_id) {
    return true;
  }
  return isManager(member, settings) || hasRole(member, settings.member_role_id);
}

async function deny(interaction, message) {
  const payload = ephemeral({ embeds: [errorEmbed(message)] });
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return false;
  }
  await interaction.reply(payload);
  return false;
}

async function requireManager(interaction) {
  const settings = getSettings(interaction.guildId);
  if (isManager(interaction.member, settings)) {
    return settings;
  }
  await deny(
    interaction,
    'Apenas gerentes ou líderes podem usar este comando.',
  );
  return null;
}

async function requireLeader(interaction) {
  const settings = getSettings(interaction.guildId);
  if (isLeader(interaction.member, settings)) {
    return settings;
  }
  await deny(interaction, 'Apenas líderes podem usar este comando.');
  return null;
}

async function requireMember(interaction) {
  const settings = getSettings(interaction.guildId);
  if (isMember(interaction.member, settings)) {
    return settings;
  }
  await deny(
    interaction,
    'Apenas membros da facção podem registrar farm. Peça o cargo a um líder.',
  );
  return null;
}

async function requireAdminChannel(interaction) {
  const settings = getSettings(interaction.guildId);
  if (!settings.admin_channel_id) {
    return settings;
  }
  if (interaction.channelId === settings.admin_channel_id) {
    return settings;
  }
  await deny(
    interaction,
    `Use este comando no canal da administração: <#${settings.admin_channel_id}>.`,
  );
  return null;
}

async function rejectIfAdminChannel(interaction) {
  const settings = getSettings(interaction.guildId);
  if (
    settings.admin_channel_id &&
    interaction.channelId === settings.admin_channel_id
  ) {
    await deny(
      interaction,
      'Este canal é só da administração. Use o painel de farm da facção.',
    );
    return false;
  }
  return true;
}

async function requireFarmChannel(interaction) {
  const settings = getSettings(interaction.guildId);
  if (!settings.farm_channel_id) {
    return settings;
  }
  if (interaction.channelId === settings.farm_channel_id) {
    return settings;
  }
  await deny(
    interaction,
    `Use o painel de farm em <#${settings.farm_channel_id}>.`,
  );
  return null;
}

module.exports = {
  getSettings,
  isGuildAdmin,
  isLeader,
  isManager,
  isMember,
  requireManager,
  requireLeader,
  requireMember,
  requireAdminChannel,
  rejectIfAdminChannel,
  requireFarmChannel,
};
