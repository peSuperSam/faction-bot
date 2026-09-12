const { REST, Routes } = require('discord.js');
const {
  upsertGuild,
  markGuildInactive,
  bootstrapEnvRolesIfNeeded,
  ensureCurrentPeriod,
  ensureDefaultEntitlement,
  getSettings,
  setSetting,
} = require('./db');
const { applyAdminChannelPermissions } = require('./staff-channel');
const { commandJson } = require('./commands');
const { BOT_NAME } = require('./brand');

async function initializeGuild(client, guild) {
  if (!guild?.id) {
    return;
  }
  upsertGuild({
    id: guild.id,
    name: guild.name,
    icon: guild.icon,
    ownerId: guild.ownerId || guild.owner_id,
    memberCount: guild.memberCount || guild.approximate_member_count || null,
  });
  bootstrapEnvRolesIfNeeded(guild.id);
  ensureCurrentPeriod(guild.id);
  ensureDefaultEntitlement(guild.id);
  const settings = getSettings(guild.id);
  if (settings.setup_status === 'pending') {
    setSetting(guild.id, 'setup_status', 'ready');
  }
  if (settings.admin_channel_id && client) {
    const adminChannel = await client.channels
      .fetch(settings.admin_channel_id)
      .catch(() => null);
    if (adminChannel?.isTextBased()) {
      const perms = await applyAdminChannelPermissions(adminChannel, settings);
      if (!perms.ok) {
        console.warn(`[${guild.id}] ${perms.message}`);
      }
    }
  }
  return getSettings(guild.id);
}

function deactivateGuild(guildId) {
  return markGuildInactive(guildId);
}

async function registerGlobalCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), {
    body: commandJson(),
  });
  console.log(`Comandos globais do ${BOT_NAME} sincronizados.`);
}

module.exports = {
  initializeGuild,
  deactivateGuild,
  registerGlobalCommands,
};
