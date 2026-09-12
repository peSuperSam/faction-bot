const {
  SlashCommandBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const {
  ensureCurrentPeriod,
  getSettings,
  setSetting,
  listMaterials,
  getMaterialById,
  addMaterial,
  deactivateMaterial,
  insertEntry,
  getEntry,
  updateEntry,
  deleteEntry,
  setEntryStatus,
  listPending,
  ownTotals,
  ranking,
  totalsByMaterial,
  userTotals,
  listGoals,
  insertAuditEvent,
  withTransaction,
} = require('./db');
const {
  requireLeader,
  requireManager,
  requireMember,
  requireAdminChannel,
  rejectIfAdminChannel,
  requireFarmChannel,
} = require('./permissions');
const {
  errorEmbed,
  successEmbed,
  registerEmbed,
  ownEntriesEmbed,
  rankingEmbed,
  reportEmbed,
  logEmbed,
  pendingEmbed,
  confirmDeleteComponents,
  pendingActionComponents,
  ephemeral,
} = require('./embeds');
const { displayMaterial, formatQuantity, parsePositiveInt, sanitizeNickname } =
  require('./util');
const { replyError } = require('./discord-util');
const {
  sendLog,
  requireCatalogMaterial,
  goalsWithProgress,
  farmBoardState,
  farmBoardMessage,
  refreshFarmPanel,
} = require('./farm-panel');
const {
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
} = require('./farm-admin');

function materialOption(option, { required = true, autocomplete = true } = {}) {
  option
    .setName('material')
    .setDescription('Material do catálogo')
    .setRequired(required)
    .setMaxLength(50);
  if (autocomplete) {
    option.setAutocomplete(true);
  }
  return option;
}

const tdcCommand = new SlashCommandBuilder()
  .setName('tdc')
  .setDescription('Comandos da administração da facção')
  .setDefaultMemberPermissions(0n)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('painel')
      .setDescription('Cria o painel da staff neste canal'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('publicar')
      .setDescription('Publica ou atualiza o painel de farm da facção')
      .addChannelOption((option) =>
        option
          .setName('canal')
          .setDescription('Canal público do farm. Se omitido, usa o canal configurado')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('apelido')
      .setDescription('Altera o apelido de um membro no servidor')
      .addUserOption((option) =>
        option
          .setName('membro')
          .setDescription('Membro que vai receber o apelido')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('nome')
          .setDescription('Novo apelido no Discord (até 32 caracteres)')
          .setRequired(true)
          .setMaxLength(32),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('canal-farm')
      .setDescription('Define o canal público do painel de farm')
      .addChannelOption((option) =>
        option
          .setName('canal')
          .setDescription('Canal de texto. Se omitido, usa o canal atual')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('canal-admin')
      .setDescription('Define o canal só da administração')
      .addChannelOption((option) =>
        option
          .setName('canal')
          .setDescription('Canal de texto. Se omitido, usa o canal atual')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('canal-log')
      .setDescription('Define o canal de auditoria')
      .addChannelOption((option) =>
        option
          .setName('canal')
          .setDescription('Canal de texto')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('cargo-lider')
      .setDescription('Define o cargo de líder (00)')
      .addRoleOption((option) =>
        option.setName('cargo').setDescription('Cargo').setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('cargo-gerente')
      .setDescription('Define o cargo de gerente')
      .addRoleOption((option) =>
        option.setName('cargo').setDescription('Cargo').setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('cargo-membro')
      .setDescription('Define o cargo de membro da facção')
      .addRoleOption((option) =>
        option.setName('cargo').setDescription('Cargo').setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('validacao')
      .setDescription('Define se o farm entra aprovado ou pendente')
      .addStringOption((option) =>
        option
          .setName('modo')
          .setDescription('Auto-aprovar ou exigir validação')
          .setRequired(true)
          .addChoices(
            { name: 'Auto-aprovar', value: 'auto' },
            { name: 'Pendente', value: 'pendente' },
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('material-adicionar')
      .setDescription('Adiciona um material ao catálogo')
      .addStringOption((option) =>
        option
          .setName('nome')
          .setDescription('Nome do material')
          .setRequired(true)
          .setMaxLength(50),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('material-remover')
      .setDescription('Remove um material do catálogo')
      .addStringOption((option) => materialOption(option)),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('corrigir')
      .setDescription('Corrige um registro de farm')
      .addIntegerOption((option) =>
        option
          .setName('entrada')
          .setDescription('ID do registro')
          .setRequired(true)
          .setMinValue(1),
      )
      .addStringOption((option) =>
        option
          .setName('motivo')
          .setDescription('Motivo da correção')
          .setRequired(true)
          .setMaxLength(200),
      )
      .addIntegerOption((option) =>
        option
          .setName('quantidade')
          .setDescription('Nova quantidade')
          .setRequired(false)
          .setMinValue(1),
      )
      .addStringOption((option) =>
        materialOption(option, { required: false }),
      )
      .addStringOption((option) =>
        option
          .setName('observacao')
          .setDescription('Nova observação')
          .setRequired(false)
          .setMaxLength(200),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('apagar')
      .setDescription('Apaga um registro de farm')
      .addIntegerOption((option) =>
        option
          .setName('entrada')
          .setDescription('ID do registro')
          .setRequired(true)
          .setMinValue(1),
      )
      .addStringOption((option) =>
        option
          .setName('motivo')
          .setDescription('Motivo da exclusão')
          .setRequired(true)
          .setMaxLength(200),
      ),
  );

const clearChatCommand = new SlashCommandBuilder()
  .setName('limparchat')
  .setDescription('Apaga mensagens recentes deste canal')
  .setDefaultMemberPermissions(0n)
  .addIntegerOption((option) =>
    option
      .setName('quantidade')
      .setDescription('Quantas mensagens apagar (1 a 500). Padrão: 100')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(500),
  );

tdcCommand.setDMPermission(false);
clearChatCommand.setDMPermission(false);

const TDC_BOOTSTRAP = new Set(['canal-admin']);

async function createFarmEntry(interaction, { materialName, quantity, note }) {
  if (!(await requireMember(interaction))) {
    return null;
  }
  const material = requireCatalogMaterial(interaction.guildId, materialName);
  const { id, period, status } = withTransaction(() => {
    const created = insertEntry({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      material: material.name,
      quantity,
      note,
    });
    insertAuditEvent({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      action: created.duplicate ? 'farm.register.duplicate' : 'farm.register',
      targetId: String(created.id),
      detail: `${material.name} x${quantity}`,
    });
    return created;
  });
  const entry = { id, material: material.name, quantity, note, status };
  const statusLabel = status === 'pending' ? 'pendente' : 'aprovado';
  await sendLog(
    interaction,
    logEmbed(
      'Farm registrado',
      `<@${interaction.user.id}> lançou **${formatQuantity(quantity)}x ${displayMaterial(material.name)}** (ID \`${id}\`, ${statusLabel}).`,
      interaction.user.tag,
    ),
  );
  await refreshFarmPanel(interaction.client, interaction.guildId);
  return { entry, period };
}

async function handleOwnEntries(interaction, user = interaction.user) {
  const period = ensureCurrentPeriod(interaction.guildId);
  const rawMaterial = interaction.isChatInputCommand()
    ? interaction.options.getString('material')
    : null;
  const material = rawMaterial
    ? requireCatalogMaterial(interaction.guildId, rawMaterial).name
    : null;
  const rows = ownTotals(interaction.guildId, user.id, period.id, material);
  const goals = listGoals(interaction.guildId, period.id).filter(
    (goal) => goal.scope === 'user' && goal.user_id === user.id,
  );
  const payload = {
    embeds: [ownEntriesEmbed(rows, goals, period)],
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.editReply(ephemeral(payload));
    return;
  }
  await interaction.reply(ephemeral(payload));
}

async function handleRanking(interaction, { ephemeralReply = false } = {}) {
  const period = ensureCurrentPeriod(interaction.guildId);
  const rawMaterial = interaction.isChatInputCommand()
    ? interaction.options.getString('material')
    : null;
  const material = rawMaterial
    ? requireCatalogMaterial(interaction.guildId, rawMaterial).name
    : null;
  const rows = ranking(interaction.guildId, period.id, material);
  const payload = {
    allowedMentions: { parse: [] },
    embeds: [rankingEmbed(rows, material, period)],
  };
  if (ephemeralReply) {
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(ephemeral(payload));
      return;
    }
    await interaction.reply(ephemeral(payload));
    return;
  }
  await interaction.reply(ephemeral(payload));
}

async function handleMaterialAdd(interaction) {
  if (!(await requireLeader(interaction))) {
    return;
  }
  const material = addMaterial(
    interaction.guildId,
    interaction.options.getString('nome', true),
  );
  await interaction.reply(
    ephemeral({
      embeds: [
        successEmbed(
          'Material adicionado',
          `**${material.display_name}** entrou no catálogo.`,
        ),
      ],
    }),
  );
  await refreshFarmPanel(interaction.client, interaction.guildId);
}

async function handleMaterialRemove(interaction) {
  if (!(await requireLeader(interaction))) {
    return;
  }
  const material = deactivateMaterial(
    interaction.guildId,
    interaction.options.getString('material', true),
  );
  await interaction.reply(
    ephemeral({
      embeds: [
        successEmbed(
          'Material removido',
          `**${material.display_name}** foi desativado e não aparece mais no menu de farm.`,
        ),
      ],
    }),
  );
  await refreshFarmPanel(interaction.client, interaction.guildId);
  await refreshFarmPanel(interaction.client, interaction.guildId);
}

async function listAbsentees(interaction, period, settings) {
  if (!settings.member_role_id) {
    return null;
  }
  try {
    await interaction.guild.members.fetch();
  } catch {
    return [
      'Não foi possível listar os membros. Ative Server Members Intent no portal do Discord.',
    ];
  }
  const role = interaction.guild.roles.cache.get(settings.member_role_id);
  if (!role) {
    return ['Cargo de membro configurado não foi encontrado.'];
  }
  const farmed = new Set(
    userTotals(interaction.guildId, period.id).map((row) => row.user_id),
  );
  return [...role.members.values()]
    .filter((member) => !member.user.bot && !farmed.has(member.id))
    .map((member) => `${member.user.tag} (<@${member.id}>)`);
}

async function handleReport(interaction) {
  const settings = await requireManager(interaction);
  if (!settings) {
    return;
  }
  const period = ensureCurrentPeriod(interaction.guildId);
  const totals = totalsByMaterial(interaction.guildId, period.id);
  const goals = goalsWithProgress(interaction.guildId, period.id);
  const absentees = await listAbsentees(interaction, period, settings);
  await interaction.reply({
    embeds: [reportEmbed({ totals, goals, absentees, period })],
  });
}

async function applyValidation(interaction, entryId, action) {
  if (!(await requireAdminChannel(interaction))) {
    return;
  }
  const settings = await requireManager(interaction);
  if (!settings) {
    return;
  }
  const status = action === 'aprovar' ? 'approved' : 'rejected';
  const entry = withTransaction(() => {
    const updated = setEntryStatus(
      interaction.guildId,
      entryId,
      status,
      interaction.user.id,
    );
    insertAuditEvent({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      action: `farm.${status}`,
      targetId: String(entryId),
      detail: updated.material,
    });
    return updated;
  });
  await sendLog(
    interaction,
    logEmbed(
      status === 'approved' ? 'Registro aprovado' : 'Registro rejeitado',
      `ID \`${entry.id}\` de <@${entry.user_id}> (${formatQuantity(entry.quantity)}x ${displayMaterial(entry.material)}).`,
      interaction.user.tag,
    ),
  );
  const payload = ephemeral({
    embeds: [
      successEmbed(
        status === 'approved' ? 'Aprovado' : 'Rejeitado',
        `Registro \`#${entry.id}\` marcado como ${status === 'approved' ? 'aprovado' : 'rejeitado'}.`,
      ),
    ],
  });
  if (interaction.isButton()) {
    await interaction.update({
      embeds: payload.embeds,
      components: [],
    });
    await refreshFarmPanel(interaction.client, interaction.guildId);
    return;
  }
  await interaction.reply(payload);
  await refreshFarmPanel(interaction.client, interaction.guildId);
}

async function handleShowPending(interaction) {
  const settings = await requireManager(interaction);
  if (!settings) {
    return;
  }
  const period = ensureCurrentPeriod(interaction.guildId);
  const pending = listPending(interaction.guildId, period.id);
  if (pending.length === 0) {
    const auto = Number(settings.auto_approve) !== 0;
    await interaction.reply(
      ephemeral({
        embeds: [
          successEmbed(
            'Nada pendente',
            auto
              ? 'Os registros entram aprovados. Use `/tdc validacao` para exigir aprovação, ou `/tdc corrigir` / `/tdc apagar` para auditoria.'
              : 'Não há registros pendentes nesta semana.',
          ),
        ],
      }),
    );
    return;
  }
  await interaction.reply(
    ephemeral({
      embeds: [pendingEmbed(pending, period)],
      components: pendingActionComponents(pending),
    }),
  );
}

async function handleCorrect(interaction) {
  if (!(await requireManager(interaction))) {
    return;
  }
  const id = interaction.options.getInteger('entrada', true);
  const reason = interaction.options.getString('motivo', true);
  const current = getEntry(interaction.guildId, id);
  if (!current) {
    await replyError(interaction, 'Registro não encontrado.');
    return;
  }
  const rawMaterial = interaction.options.getString('material');
  const material = rawMaterial
    ? requireCatalogMaterial(interaction.guildId, rawMaterial).name
    : undefined;
  const note = interaction.options.getString('observacao');
  const updated = withTransaction(() => {
    const row = updateEntry(interaction.guildId, id, {
      quantity: interaction.options.getInteger('quantidade') ?? undefined,
      material,
      note: note === null ? undefined : note.trim() || null,
      reviewedBy: interaction.user.id,
    });
    insertAuditEvent({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      action: 'farm.correct',
      targetId: String(id),
      detail: reason,
    });
    return row;
  });
  await sendLog(
    interaction,
    logEmbed(
      'Registro corrigido',
      `ID \`${updated.id}\`: ${formatQuantity(current.quantity)}x ${displayMaterial(current.material)} → ${formatQuantity(updated.quantity)}x ${displayMaterial(updated.material)}.\nMotivo: ${reason}`,
      interaction.user.tag,
    ),
  );
  await interaction.reply(
    ephemeral({
      embeds: [
        successEmbed(
          'Registro atualizado',
          `ID \`${updated.id}\` agora é **${formatQuantity(updated.quantity)}x ${displayMaterial(updated.material)}**.`,
        ),
      ],
    }),
  );
  await refreshFarmPanel(interaction.client, interaction.guildId);
}

async function handleDeleteRequest(interaction) {
  if (!(await requireManager(interaction))) {
    return;
  }
  const id = interaction.options.getInteger('entrada', true);
  const reason = interaction.options.getString('motivo', true);
  const entry = getEntry(interaction.guildId, id);
  if (!entry) {
    await replyError(interaction, 'Registro não encontrado.');
    return;
  }
  await interaction.reply(
    ephemeral({
      embeds: [
        errorEmbed(
          `Confirma apagar o registro \`#${entry.id}\` de <@${entry.user_id}> (${formatQuantity(entry.quantity)}x ${displayMaterial(entry.material)})?\nMotivo: ${reason}`,
        ),
      ],
      components: confirmDeleteComponents(id),
    }),
  );
}

async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'material') {
    await interaction.respond([]);
    return;
  }
  const rows = listMaterials(interaction.guildId, {
    query: focused.value,
  }).slice(0, 25);
  await interaction.respond(
    rows.map((row) => ({
      name: row.display_name.slice(0, 100),
      value: row.name,
    })),
  );
}

async function showRegisterModal(interaction, material) {
  const modal = new ModalBuilder()
    .setCustomId(`farm:modal:register:${material.id}`)
    .setTitle(`Registrar ${material.display_name}`.slice(0, 45));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('quantidade')
        .setLabel('Quantidade')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(8),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('observacao')
        .setLabel('Observação (opcional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200),
    ),
  );
  await interaction.showModal(modal);
}

async function handleComponent(interaction) {
  if (!interaction.inGuild()) {
    await replyError(interaction, 'Use este comando em um servidor.');
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'tdc:select:meta') {
    if (!(await requireAdminChannel(interaction))) {
      return;
    }
    await handleSingleGoalModalOpen(interaction, interaction.values[0]);
    return;
  }

  if (
    interaction.isModalSubmit() &&
    (interaction.customId === 'tdc:modal:metas' ||
      interaction.customId.startsWith('tdc:modal:meta:'))
  ) {
    if (!(await requireAdminChannel(interaction))) {
      return;
    }
    await handleGoalsModalSubmit(interaction);
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'farm:select:material') {
    if (!(await rejectIfAdminChannel(interaction))) {
      return;
    }
    if (!(await requireFarmChannel(interaction))) {
      return;
    }
    const material = getMaterialById(
      interaction.guildId,
      Number(interaction.values[0]),
    );
    if (!material) {
      await replyError(interaction, 'Material inativo ou inexistente.');
      return;
    }
    await showRegisterModal(interaction, material);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('farm:modal:register:')) {
    if (!(await rejectIfAdminChannel(interaction))) {
      return;
    }
    if (!(await requireFarmChannel(interaction))) {
      return;
    }
    const materialId = Number(interaction.customId.split(':').pop());
    const material = getMaterialById(interaction.guildId, materialId);
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
    const note =
      interaction.fields.getTextInputValue('observacao')?.trim() || null;
    const created = await createFarmEntry(interaction, {
      materialName: material.name,
      quantity,
      note,
    });
    if (!created) {
      return;
    }
    const { entry, period } = created;
    await interaction.reply(
      ephemeral({ embeds: [registerEmbed(entry, period)] }),
    );
    return;
  }

  if (!interaction.isButton()) {
    return;
  }

  const [scope, action, extra, id] = interaction.customId.split(':');

  if (scope === 'tdc' && action === 'staff') {
    if (!(await requireAdminChannel(interaction))) {
      return;
    }
    if (extra === 'metas') {
      await handleGoalsModalOpen(interaction);
      return;
    }
    if (extra === 'publicar') {
      await handlePublicar(interaction);
      return;
    }
    if (extra === 'relatorio') {
      await handleReport(interaction);
      return;
    }
    if (extra === 'validar') {
      await handleShowPending(interaction);
      return;
    }
    return;
  }

  if (scope !== 'farm') {
    return;
  }

  if (action === 'panel' && extra === 'ranking') {
    if (!(await rejectIfAdminChannel(interaction))) {
      return;
    }
    if (!(await requireFarmChannel(interaction))) {
      return;
    }
    await handleRanking(interaction, { ephemeralReply: true });
    return;
  }
  if (action === 'panel' && extra === 'mine') {
    if (!(await rejectIfAdminChannel(interaction))) {
      return;
    }
    if (!(await requireFarmChannel(interaction))) {
      return;
    }
    await handleOwnEntries(interaction);
    return;
  }
  if (action === 'delete' && extra === 'no') {
    await interaction.update({
      embeds: [successEmbed('Exclusão cancelada', 'O registro foi mantido.')],
      components: [],
    });
    return;
  }
  if (action === 'delete' && extra === 'yes') {
    if (!(await requireAdminChannel(interaction))) {
      return;
    }
    if (!(await requireManager(interaction))) {
      return;
    }
    const entry = withTransaction(() => {
      const removed = deleteEntry(interaction.guildId, Number(id));
      insertAuditEvent({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: 'farm.delete',
        targetId: String(id),
        detail: removed.material,
      });
      return removed;
    });
    await sendLog(
      interaction,
      logEmbed(
        'Registro apagado',
        `ID \`${entry.id}\` de <@${entry.user_id}> (${formatQuantity(entry.quantity)}x ${displayMaterial(entry.material)}) foi removido.`,
        interaction.user.tag,
      ),
    );
    await interaction.update({
      embeds: [
        successEmbed(
          'Registro apagado',
          `O lançamento \`#${entry.id}\` foi removido.`,
        ),
      ],
      components: [],
    });
    await refreshFarmPanel(interaction.client, interaction.guildId);
    return;
  }
  if (action === 'validate' && extra === 'approve') {
    await applyValidation(interaction, Number(id), 'aprovar');
    return;
  }
  if (action === 'validate' && extra === 'reject') {
    await applyValidation(interaction, Number(id), 'rejeitar');
    return;
  }
}

async function handleClearChat(interaction) {
  if (!(await requireManager(interaction))) {
    return;
  }
  const channel = interaction.channel;
  if (!channel?.isTextBased() || channel.isDMBased?.()) {
    await replyError(interaction, 'Use este comando em um canal de texto do servidor.');
    return;
  }
  const me = interaction.guild.members.me;
  if (!me?.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages)) {
    await replyError(
      interaction,
      'O Coroa precisa da permissão **Gerenciar mensagens** neste canal.',
    );
    return;
  }

  const requested = interaction.options.getInteger('quantidade') || 100;
  await interaction.deferReply({ flags: ephemeral({}).flags });

  const settings = getSettings(interaction.guildId);
  const keepIds = new Set(
    [settings.farm_panel_message_id].filter(Boolean),
  );
  const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
  let deleted = 0;

  while (deleted < requested) {
    const batch = await channel.messages.fetch({ limit: 100 });
    const candidates = [...batch.values()].filter((message) => {
      if (keepIds.has(message.id) || message.pinned) {
        return false;
      }
      if (Date.now() - message.createdTimestamp >= twoWeeksMs) {
        return false;
      }
      return true;
    });
    if (candidates.length === 0) {
      break;
    }
    const slice = candidates.slice(0, requested - deleted);
    if (slice.length === 1) {
      try {
        await slice[0].delete();
        deleted += 1;
      } catch {
        break;
      }
    } else {
      const result = await channel.bulkDelete(slice, true);
      deleted += result.size;
      if (result.size === 0) {
        break;
      }
    }
  }

  const extra =
    deleted < requested
      ? '\nMensagens fixadas, o painel de farm e as com mais de 14 dias não entram na limpeza.'
      : '';
  await interaction.editReply(
    ephemeral({
      embeds: [
        successEmbed(
          'Chat limpo',
          `Apaguei **${deleted}** mensagem(ns).${extra}`,
        ),
      ],
    }),
  );
  await sendLog(
    interaction,
    logEmbed(
      'Chat limpo',
      `<@${interaction.user.id}> apagou ${deleted} mensagem(ns) em <#${channel.id}>.`,
      interaction.user.tag,
    ),
  );
}

async function handleTdcCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (!TDC_BOOTSTRAP.has(sub) && !(await requireAdminChannel(interaction))) {
    return;
  }

  switch (sub) {
    case 'painel':
      await handleStaffPanel(interaction);
      break;
    case 'publicar':
      await handlePublicar(interaction);
      break;
    case 'apelido':
      await handleNickname(interaction);
      break;
    case 'canal-farm':
      await handleConfigFarmCanal(interaction);
      break;
    case 'canal-admin':
      await handleConfigAdminCanal(interaction);
      break;
    case 'canal-log':
      await handleConfig(interaction, 'log_channel_id');
      break;
    case 'cargo-lider':
      await handleConfig(interaction, 'leader_role_id');
      break;
    case 'cargo-gerente':
      await handleConfig(interaction, 'manager_role_id');
      break;
    case 'cargo-membro':
      await handleConfig(interaction, 'member_role_id');
      break;
    case 'validacao':
      await handleConfigValidacao(interaction);
      break;
    case 'material-adicionar':
      await handleMaterialAdd(interaction);
      break;
    case 'material-remover':
      await handleMaterialRemove(interaction);
      break;
    case 'corrigir':
      await handleCorrect(interaction);
      break;
    case 'apagar':
      await handleDeleteRequest(interaction);
      break;
    default:
      await replyError(interaction, 'Subcomando não reconhecido.');
  }
}

module.exports = {
  tdcCommand,
  clearChatCommand,
  handleAutocomplete,
  handleComponent,
  handleTdcCommand,
  handleClearChat,
  farmBoardMessage,
  farmBoardState,
  refreshFarmPanel,
};
