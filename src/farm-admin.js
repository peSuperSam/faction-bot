const {
  ActionRowBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');
const {
  ensureCurrentPeriod,
  getSettings,
  setSetting,
  listMaterials,
  getMaterialById,
  listGoals,
  upsertGoal,
} = require('./db');
const {
  requireLeader,
  requireManager,
} = require('./permissions');
const { sanitizeNickname, displayMaterial, formatQuantity, parsePositiveInt } =
  require('./util');
const {
  describePermResult,
  syncAdminChannelPermissions,
  sendLog,
  staffPanelMessage,
  refreshFarmPanel,
  publishFarmBoard,
} = require('./farm-panel');
const { applyAdminChannelPermissions } = require('./staff-channel');
const { replyError } = require('./discord-util');
const { logEmbed, successEmbed, ephemeral } = require('./embeds');

async function handleConfig(interaction, key) {
  if (!(await requireLeader(interaction))) {
    return;
  }
  if (key === 'log_channel_id') {
    const channel = interaction.options.getChannel('canal', true);
    setSetting(interaction.guildId, key, channel.id);
    await interaction.reply(
      ephemeral({
        embeds: [
          successEmbed('Canal de log definido', `Auditoria em ${channel}.`),
        ],
      }),
    );
    return;
  }
  const role = interaction.options.getRole('cargo', true);
  setSetting(interaction.guildId, key, role.id);
  const permResult = await syncAdminChannelPermissions(
    interaction.client,
    interaction.guildId,
  );
  const permText =
    key === 'member_role_id' || key === 'leader_role_id' || key === 'manager_role_id'
      ? describePermResult(permResult)
      : '';
  await interaction.reply(
    ephemeral({
      embeds: [
        successEmbed(
          'Cargo atualizado',
          `Configurado: ${role}.${permText}`,
        ),
      ],
    }),
  );
}

async function handleConfigAdminCanal(interaction) {
  if (!(await requireLeader(interaction))) {
    return;
  }
  const channel =
    interaction.options.getChannel('canal') || interaction.channel;
  if (!channel?.isTextBased()) {
    await replyError(interaction, 'Escolha um canal de texto.');
    return;
  }
  setSetting(interaction.guildId, 'admin_channel_id', channel.id);
  const settings = getSettings(interaction.guildId);
  const permResult = await applyAdminChannelPermissions(channel, settings);
  if (interaction.channelId !== channel.id) {
    await channel
      .send({
        allowedMentions: { parse: [] },
        embeds: [
          successEmbed(
            'Canal da administração',
            `Este chat passou a ser o canal da staff. Use /tdc painel aqui.${describePermResult(permResult)}`,
          ),
        ],
      })
      .catch(() => {});
  }
  await interaction.reply({
    allowedMentions: { parse: [] },
    embeds: [
      successEmbed(
        'Canal da administração definido',
        `${channel} passou a ser o chat da staff. Comandos /tdc só funcionam aí (exceto canal-admin).${describePermResult(permResult)}`,
      ),
    ],
  });
}

async function handleNickname(interaction) {
  if (!(await requireManager(interaction))) {
    return;
  }
  const user = interaction.options.getUser('membro', true);
  const member =
    interaction.options.getMember('membro') ||
    (await interaction.guild.members.fetch(user.id).catch(() => null));
  if (!member) {
    await replyError(interaction, 'Esse usuário não está neste servidor.');
    return;
  }

  const nick = sanitizeNickname(interaction.options.getString('nome', true));
  if (!nick) {
    await replyError(
      interaction,
      'Informe um apelido válido, com até 32 caracteres, sem @everyone, @here ou convite.',
    );
    return;
  }

  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageNicknames)) {
    await replyError(
      interaction,
      'O Coroa precisa da permissão **Gerenciar apelidos**. Marque isso no cargo do bot.',
    );
    return;
  }
  if (member.id === interaction.guild.ownerId) {
    await replyError(
      interaction,
      'Não consigo alterar o apelido do dono do servidor.',
    );
    return;
  }
  if (
    member.id !== me.id &&
    member.roles.highest.position >= me.roles.highest.position
  ) {
    await replyError(
      interaction,
      'O cargo do Coroa precisa ficar **acima** do cargo desse membro na lista de cargos.',
    );
    return;
  }

  const previous = member.nickname || member.user.username;
  try {
    await member.setNickname(nick, `Alterado por ${interaction.user.tag}`);
  } catch (error) {
    if (error.code === 50013) {
      await replyError(
        interaction,
        'Sem permissão para alterar esse apelido. Confira o cargo do Coroa e a permissão Gerenciar apelidos.',
      );
      return;
    }
    throw error;
  }

  await sendLog(
    interaction,
    logEmbed(
      'Apelido alterado',
      `<@${interaction.user.id}> mudou **${previous}** para **${nick}** (<@${member.id}>).`,
      interaction.user.tag,
    ),
  );
  await interaction.reply({
    allowedMentions: { parse: [], users: [member.id] },
    embeds: [
      successEmbed(
        'Apelido atualizado',
        `<@${member.id}> agora aparece como **${nick}**.`,
      ),
    ],
  });
}

async function handleConfigValidacao(interaction) {
  if (!(await requireLeader(interaction))) {
    return;
  }
  const modo = interaction.options.getString('modo', true);
  const auto = modo === 'auto';
  setSetting(interaction.guildId, 'auto_approve', auto ? 1 : 0);
  await interaction.reply(
    ephemeral({
      embeds: [
        successEmbed(
          'Validação atualizada',
          auto
            ? 'Novos registros entram aprovados. A liderança corrige ou apaga se precisar.'
            : 'Novos registros entram pendentes até um gerente validar.',
        ),
      ],
    }),
  );
}

async function handleConfigFarmCanal(interaction) {
  if (!(await requireLeader(interaction))) {
    return;
  }
  const channel =
    interaction.options.getChannel('canal') || interaction.channel;
  if (!channel?.isTextBased()) {
    await replyError(interaction, 'Escolha um canal de texto.');
    return;
  }
  setSetting(interaction.guildId, 'farm_channel_id', channel.id);
  await interaction.reply(
    ephemeral({
      embeds: [
        successEmbed(
          'Canal de farm definido',
          `O painel público vai em ${channel}. Use **Atualizar painel** ou \`/tdc publicar\`.`,
        ),
      ],
    }),
  );
}

async function handleStaffPanel(interaction) {
  if (!(await requireManager(interaction))) {
    return;
  }
  await interaction.reply(staffPanelMessage(interaction.guildId));
}

async function publishToFarmChannel(interaction, channel) {
  setSetting(interaction.guildId, 'farm_channel_id', channel.id);
  await publishFarmBoard(interaction.client, interaction.guildId, channel);
}

async function handlePublicar(interaction) {
  if (!(await requireManager(interaction))) {
    return;
  }
  const settings = getSettings(interaction.guildId);
  const selected = interaction.isChatInputCommand()
    ? interaction.options.getChannel('canal')
    : null;
  let channel = selected;
  if (!channel && settings.farm_channel_id) {
    channel = await interaction.client.channels
      .fetch(settings.farm_channel_id)
      .catch(() => null);
  }
  if (!channel?.isTextBased()) {
    await replyError(
      interaction,
      'Informe o canal em `/tdc publicar` ou defina com `/tdc canal-farm`.',
    );
    return;
  }
  await publishToFarmChannel(interaction, channel);
  await interaction.reply(
    ephemeral({
      embeds: [
        successEmbed(
          'Painel publicado',
          `A facção usa o painel em ${channel}.`,
        ),
      ],
    }),
  );
}

function goalsModal(materials, existingGoals) {
  const modal = new ModalBuilder()
    .setCustomId('tdc:modal:metas')
    .setTitle('Metas da semana');
  const goalByMaterial = new Map(
    (existingGoals || [])
      .filter((goal) => goal.scope === 'guild')
      .map((goal) => [goal.material, goal]),
  );
  for (const material of materials.slice(0, 5)) {
    const current = goalByMaterial.get(material.name);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`meta:${material.id}`)
          .setLabel(material.display_name.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(10)
          .setPlaceholder(
            current ? String(current.quantity) : 'Quantidade da semana',
          ),
      ),
    );
  }
  return modal;
}

async function handleGoalsModalOpen(interaction) {
  if (!(await requireManager(interaction))) {
    return;
  }
  const materials = listMaterials(interaction.guildId);
  if (materials.length === 0) {
    await replyError(
      interaction,
      'Cadastre materiais com `/tdc material-adicionar` antes de definir metas.',
    );
    return;
  }
  const period = ensureCurrentPeriod(interaction.guildId);
  const goals = listGoals(interaction.guildId, period.id);
  if (materials.length <= 5) {
    await interaction.showModal(goalsModal(materials, goals));
    return;
  }
  await interaction.reply(
    ephemeral({
      embeds: [
        successEmbed(
          'Escolha o item',
          'Há mais de 5 materiais. Escolha um para definir a meta.',
        ),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('tdc:select:meta')
            .setPlaceholder('Material da meta')
            .addOptions(
              materials.slice(0, 25).map((material) => ({
                label: material.display_name.slice(0, 100),
                value: String(material.id),
              })),
            ),
        ),
      ],
    }),
  );
}

async function handleSingleGoalModalOpen(interaction, materialId) {
  if (!(await requireManager(interaction))) {
    return;
  }
  const material = getMaterialById(interaction.guildId, Number(materialId));
  if (!material) {
    await replyError(interaction, 'Material inativo ou inexistente.');
    return;
  }
  const period = ensureCurrentPeriod(interaction.guildId);
  const current = listGoals(interaction.guildId, period.id).find(
    (goal) => goal.scope === 'guild' && goal.material === material.name,
  );
  const modal = new ModalBuilder()
    .setCustomId(`tdc:modal:meta:${material.id}`)
    .setTitle(`Meta • ${material.display_name}`.slice(0, 45));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('quantidade')
        .setLabel('Quantidade da semana')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10)
        .setPlaceholder(current ? String(current.quantity) : 'Ex: 500'),
    ),
  );
  await interaction.showModal(modal);
}

async function saveGuildGoals(interaction, updates) {
  const period = ensureCurrentPeriod(interaction.guildId);
  const saved = [];
  for (const { material, quantity } of updates) {
    saved.push(
      upsertGoal({
        guildId: interaction.guildId,
        material: material.name,
        quantity,
        scope: 'guild',
        userId: null,
        periodId: period.id,
      }),
    );
  }
  await sendLog(
    interaction,
    logEmbed(
      'Metas atualizadas',
      saved
        .map(
          (goal) =>
            `**${displayMaterial(goal.material)}**: ${formatQuantity(goal.quantity)}`,
        )
        .join('\n'),
      interaction.user.tag,
    ),
  );
  await refreshFarmPanel(interaction.client, interaction.guildId);
  await interaction.reply(
    ephemeral({
      embeds: [
        successEmbed(
          'Metas atualizadas',
          saved
            .map(
              (goal) =>
                `• **${displayMaterial(goal.material)}**: ${formatQuantity(goal.quantity)}`,
            )
            .join('\n'),
        ),
      ],
    }),
  );
}

async function handleGoalsModalSubmit(interaction) {
  if (!(await requireManager(interaction))) {
    return;
  }
  const updates = [];
  if (interaction.customId === 'tdc:modal:metas') {
    for (const material of listMaterials(interaction.guildId).slice(0, 5)) {
      let raw = '';
      try {
        raw = interaction.fields.getTextInputValue(`meta:${material.id}`).trim();
      } catch {
        continue;
      }
      if (!raw) {
        continue;
      }
      const quantity = parsePositiveInt(raw);
      if (!quantity) {
        await replyError(
          interaction,
          `Quantidade inválida para ${material.display_name}. Use só números.`,
        );
        return;
      }
      updates.push({ material, quantity });
    }
  } else {
    const material = getMaterialById(
      interaction.guildId,
      Number(interaction.customId.split(':').pop()),
    );
    if (!material) {
      await replyError(interaction, 'Material inativo ou inexistente.');
      return;
    }
    const quantity = parsePositiveInt(
      interaction.fields.getTextInputValue('quantidade'),
    );
    if (!quantity) {
      await replyError(interaction, 'Informe uma quantidade inteira maior que zero.');
      return;
    }
    updates.push({ material, quantity });
  }
  if (updates.length === 0) {
    await replyError(interaction, 'Preencha pelo menos uma meta.');
    return;
  }
  await saveGuildGoals(interaction, updates);
}

module.exports = {
  handleConfig,
  handleConfigAdminCanal,
  handleNickname,
  handleConfigValidacao,
  handleConfigFarmCanal,
  handleStaffPanel,
  handlePublicar,
  handleGoalsModalOpen,
  handleSingleGoalModalOpen,
  handleGoalsModalSubmit,
};
