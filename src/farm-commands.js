const {
  SlashCommandBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const {
  ensureCurrentPeriod,
  getSettings,
  setSetting,
  listMaterials,
  getMaterial,
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
  userMaterialTotal,
  guildMaterialTotal,
  upsertGoal,
  listGoals,
  insertAuditEvent,
  withTransaction,
  envRoleId,
  ROLE_ENV,
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
  farmBoardEmbed,
  farmBoardComponents,
  staffPanelEmbed,
  staffPanelComponents,
  pendingEmbed,
  confirmDeleteComponents,
  pendingActionComponents,
  ephemeral,
} = require('./embeds');
const { normalizeMaterial, displayMaterial, formatQuantity, parsePositiveInt, sanitizeNickname, truncate } =
  require('./util');
const { applyAdminChannelPermissions } = require('./staff-channel');
const { replyError } = require('./discord-util');

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
  const envName = ROLE_ENV[key];
  if (envName && envRoleId(envName)) {
    await replyError(
      interaction,
      `Este cargo vem do .env (${envName}). Altere o ID lá e reinicie o bot.`,
    );
    return;
  }
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
