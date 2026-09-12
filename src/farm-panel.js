const {
  ensureCurrentPeriod,
  getSettings,
  setSetting,
  listMaterials,
  getMaterial,
  totalsByMaterial,
  userMaterialTotal,
  guildMaterialTotal,
  listGoals,
  insertAuditEvent,
} = require('./db');
const {
  farmBoardEmbed,
  farmBoardComponents,
  staffPanelEmbed,
  staffPanelComponents,
} = require('./embeds');
const { truncate } = require('./util');
const { applyAdminChannelPermissions } = require('./staff-channel');

function describePermResult(result) {
  if (!result) {
    return '';
  }
  if (!result.ok) {
    return `\n${result.message}`;
  }
  if (!result.notes.length) {
    return '\nO canal foi travado: só 00, gerentes e o Coroa entram.';
  }
  return `\nO canal foi travado.\n${result.notes.map((note) => `• ${note}`).join('\n')}`;
}

async function syncAdminChannelPermissions(client, guildId) {
  const settings = getSettings(guildId);
  if (!settings.admin_channel_id) {
    return null;
  }
  const channel = await client.channels
    .fetch(settings.admin_channel_id)
    .catch(() => null);
  if (!channel?.isTextBased() || !channel.guild) {
    return null;
  }
  return applyAdminChannelPermissions(channel, settings);
}

async function sendLog(interaction, embed) {
  try {
    insertAuditEvent({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      action: embed.data?.title || 'log',
      detail: truncate(embed.data?.description || '', 500),
    });
  } catch (error) {
    console.error('Falha ao gravar auditoria local:', error.message);
  }
  const settings = getSettings(interaction.guildId);
  if (!settings.log_channel_id) {
    return;
  }
  try {
    const channel = await interaction.client.channels.fetch(
      settings.log_channel_id,
    );
    if (channel?.isTextBased()) {
      await channel.send({
        embeds: [embed],
        allowedMentions: { parse: ['users'] },
      });
    }
  } catch (error) {
    console.error('Falha ao enviar log:', error.message);
  }
}

function requireCatalogMaterial(guildId, rawName) {
  const material = getMaterial(guildId, rawName);
  if (!material) {
    throw new Error(
      'Material fora do catálogo. Peça a um líder para cadastrá-lo com `/tdc material-adicionar`.',
    );
  }
  return material;
}

function goalsWithProgress(guildId, periodId, onlyUserId = null) {
  return listGoals(guildId, periodId)
    .filter((goal) => {
      if (!onlyUserId) {
        return true;
      }
      return (
        (goal.scope === 'user' && goal.user_id === onlyUserId) ||
        goal.scope === 'guild'
      );
    })
    .map((goal) => ({
      ...goal,
      current:
        goal.scope === 'user'
          ? userMaterialTotal(guildId, periodId, goal.user_id, goal.material)
          : guildMaterialTotal(guildId, periodId, goal.material),
    }));
}

function farmBoardState(guildId) {
  const period = ensureCurrentPeriod(guildId);
  const materials = listMaterials(guildId);
  const goals = goalsWithProgress(guildId, period.id).filter(
    (goal) => goal.scope === 'guild',
  );
  const totals = totalsByMaterial(guildId, period.id);
  return { period, materials, goals, totals };
}

function farmBoardMessage(guildId) {
  const state = farmBoardState(guildId);
  return {
    allowedMentions: { parse: [] },
    embeds: [farmBoardEmbed(state)],
    components: farmBoardComponents(state.materials),
  };
}

function staffPanelMessage(guildId) {
  const { period, goals } = farmBoardState(guildId);
  const settings = getSettings(guildId);
  return {
    allowedMentions: { parse: [] },
    embeds: [
      staffPanelEmbed({
        period,
        farmChannelId: settings.farm_channel_id,
        goals,
      }),
    ],
    components: staffPanelComponents(),
  };
}

async function refreshFarmPanel(client, guildId) {
  const settings = getSettings(guildId);
  if (!settings.farm_channel_id || !settings.farm_panel_message_id) {
    return false;
  }
  try {
    const channel = await client.channels.fetch(settings.farm_channel_id);
    if (!channel?.isTextBased()) {
      return false;
    }
    const message = await channel.messages.fetch(settings.farm_panel_message_id);
    await message.edit(farmBoardMessage(guildId));
    return true;
  } catch (error) {
    console.error('Falha ao atualizar painel de farm:', error.message);
    if (error.code === 10008 || error.status === 404) {
      setSetting(guildId, 'farm_panel_message_id', null);
    }
    return false;
  }
}

async function publishFarmBoard(client, guildId, channel) {
  const payload = farmBoardMessage(guildId);
  const settings = getSettings(guildId);
  if (
    settings.farm_channel_id === channel.id &&
    settings.farm_panel_message_id
  ) {
    try {
      const existing = await channel.messages.fetch(
        settings.farm_panel_message_id,
      );
      await existing.edit(payload);
      return existing;
    } catch {
      // message was deleted; post a new one
    }
  }
  const posted = await channel.send(payload);
  setSetting(guildId, 'farm_channel_id', channel.id);
  setSetting(guildId, 'farm_panel_message_id', posted.id);
  return posted;
}

module.exports = {
  describePermResult,
  syncAdminChannelPermissions,
  sendLog,
  requireCatalogMaterial,
  goalsWithProgress,
  farmBoardState,
  farmBoardMessage,
  staffPanelMessage,
  refreshFarmPanel,
  publishFarmBoard,
};
