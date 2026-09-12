const {
  SlashCommandBuilder,
  ChannelType,
  AttachmentBuilder,
  EmbedBuilder,
} = require('discord.js');
const { getSettings, setSetting } = require('./db');
const {
  requireLeader,
  requireAdminChannel,
  rejectIfAdminChannel,
} = require('./permissions');
const {
  errorEmbed,
  successEmbed,
  sourcesEmbed,
  partnershipEmbed,
  ephemeral,
} = require('./embeds');
const { truncate } = require('./util');
const { answerQuestion, userFacingAiError, inspectQuestion } = require('./ai');
const { getAiContextTopic, clearAiContext } = require('./user-context');
const { reloadKnowledge, listKnowledgeDocuments } = require('./knowledge');
const { reindexPublishedGuildDocs } = require('./documents');
const { replyError } = require('./discord-util');

const helpCommand = new SlashCommandBuilder()
  .setName('ajuda')
  .setDescription('Consulta as regras oficiais da facção')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('pergunta')
      .setDescription('Faz uma pergunta sobre as regras')
      .addStringOption((option) =>
        option
          .setName('pergunta')
          .setDescription('Sua dúvida sobre as regras')
          .setRequired(true)
          .setMaxLength(500),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('fontes')
      .setDescription('Mostra os documentos de regras carregados'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('recarregar')
      .setDescription('Recarrega os arquivos oficiais de regras'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('limpar-historico')
      .setDescription('Apaga o histórico da IA deste canal para você'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('diagnostico')
      .setDescription('Mostra como o Coroa roteia uma pergunta (só liderança)')
      .addStringOption((option) =>
        option
          .setName('pergunta')
          .setDescription('Pergunta para inspecionar')
          .setRequired(true)
          .setMaxLength(500),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('canal')
      .setDescription('Define o canal público do chat de IA')
      .addChannelOption((option) =>
        option
          .setName('canal')
          .setDescription('Canal de texto. Se omitido, usa o canal atual')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
  );

helpCommand.setDMPermission(false);

function cardPayload(card) {
  if (card.kind === 'price' || card.kind === 'contingente' || card.kind === 'action' || card.kind === 'clarify') {
    return {
      content: truncate(card.body || card.label, 1900),
      allowedMentions: { parse: [] },
    };
  }
  const payload = {
    allowedMentions: { parse: [] },
    embeds: [partnershipEmbed(card)],
  };
  if (card.path && card.name) {
    payload.files = [new AttachmentBuilder(card.path, { name: card.name })];
  }
  return payload;
}

async function sendPayload(send, payload) {
  try {
    return await send(payload);
  } catch (error) {
    if (!payload.files?.length) {
      throw error;
    }
    console.warn('Falha ao anexar imagem da IA:', error.message);
    const fallback = { ...payload };
    delete fallback.files;
    if (fallback.embeds?.[0]) {
      fallback.embeds = [EmbedBuilder.from(fallback.embeds[0]).setImage(null)];
    }
    return send(fallback);
  }
}

async function sendAiMessage(send, result, followUpSend) {
  const cards = result.cards?.filter(Boolean) || [];
  if (cards.length === 0) {
    return sendPayload(send, {
      content: truncate(result.answer, 1900),
      allowedMentions: { parse: [] },
    });
  }

  const extra = followUpSend || send;
  for (let index = 0; index < cards.length; index += 1) {
    await sendPayload(index === 0 ? send : extra, cardPayload(cards[index]));
  }
}

async function handleHelpQuestion(interaction) {
  if (!(await rejectIfAdminChannel(interaction))) {
    return;
  }
  const question = interaction.options.getString('pergunta', true);
  const settings = getSettings(interaction.guildId);
  const aiChannelId = settings.ai_channel_id;
  const inAiChannel = Boolean(
    aiChannelId && interaction.channelId === aiChannelId,
  );

  if (aiChannelId && !inAiChannel) {
    await interaction.deferReply({ flags: ephemeral({}).flags });
    const result = await answerQuestion({
      question,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: aiChannelId || interaction.channelId,
      conversational: true,
    });
    const channel = await interaction.guild.channels
      .fetch(aiChannelId)
      .catch(() => null);
    if (!channel?.isTextBased()) {
      await interaction.editReply(
        ephemeral({
          embeds: [
            errorEmbed(
              'O canal de IA configurado não existe mais. Use `/ajuda canal` neste chat.',
            ),
          ],
        }),
      );
      return;
    }
    await sendAiMessage(
      (payload) => channel.send(payload),
      result,
      (payload) => channel.send(payload),
    );
    await interaction.editReply(
      ephemeral({
        embeds: [
          successEmbed(
            'Respondido no chat de IA',
            `A resposta foi publicada em ${channel}.`,
          ),
        ],
      }),
    );
    return;
  }

  await interaction.deferReply();
  const result = await answerQuestion({
    question,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    conversational: Boolean(inAiChannel || !aiChannelId),
  });
  await sendAiMessage(
    (payload) => interaction.editReply(payload),
    result,
    (payload) => interaction.followUp(payload),
  );
}

async function handleHelpClear(interaction) {
  if (!(await rejectIfAdminChannel(interaction))) {
    return;
  }
  clearAiContext({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    channelId: interaction.channelId,
  });
  await interaction.reply(
    ephemeral({
      embeds: [
        successEmbed(
          'Histórico apagado',
          'A IA esqueceu sua conversa neste canal.',
        ),
      ],
    }),
  );
}

async function handleHelpCanal(interaction) {
  if (!(await requireAdminChannel(interaction))) {
    return;
  }
  if (!(await requireLeader(interaction))) {
    return;
  }
  const channel =
    interaction.options.getChannel('canal') || interaction.channel;
  if (!channel?.isTextBased()) {
    await replyError(interaction, 'Escolha um canal de texto.');
    return;
  }
  setSetting(interaction.guildId, 'ai_channel_id', channel.id);
  await interaction.reply({
    allowedMentions: { parse: [] },
    embeds: [
      successEmbed(
        'Chat de IA definido',
        `${channel} passou a ser o chat da IA. Basta mandar mensagem nesse canal — não precisa de /ajuda pergunta.`,
      ),
    ],
  });
}

async function handleHelpSources(interaction) {
  if (!(await rejectIfAdminChannel(interaction))) {
    return;
  }
  await interaction.reply(
    ephemeral({ embeds: [sourcesEmbed(listKnowledgeDocuments(interaction.guildId))] }),
  );
}

async function handleHelpReload(interaction) {
  await interaction.deferReply({ flags: ephemeral({}).flags });
  if (!(await requireAdminChannel(interaction))) {
    return;
  }
  if (!(await requireLeader(interaction))) {
    return;
  }
  const result = reloadKnowledge();
  if (!result.aborted) {
    try {
      reindexPublishedGuildDocs(interaction.guildId);
    } catch (error) {
      console.warn('Falha ao reindexar documentos da guilda:', error.message);
    }
  }
  if (result.aborted) {
    const detail = result.rejected
      .slice(0, 8)
      .map((item) => `• ${item}`)
      .join('\n');
    await interaction.editReply(
      ephemeral({
        embeds: [
          errorEmbed(
            `A recarga foi recusada. A base anterior foi mantida.${
              detail ? `\n${detail}` : ''
            }`,
          ),
        ],
      }),
    );
    return;
  }
  const rejected =
    result.rejected.length > 0
      ? `\nRecusados:\n${result.rejected.map((item) => `• ${item}`).join('\n')}`
      : '';
  await interaction.editReply(
    ephemeral({
      embeds: [
        successEmbed(
          'Base recarregada',
          `${result.indexed} documento(s) indexado(s).${rejected}`,
        ),
      ],
    }),
  );
}

async function handleHelpDiagnostico(interaction) {
  await interaction.deferReply({ flags: ephemeral({}).flags });
  if (!(await requireLeader(interaction))) {
    return;
  }
  const question = interaction.options.getString('pergunta', true);
  const prior = getAiContextTopic({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    channelId: interaction.channelId,
  });
  const info = inspectQuestion({ question, prior, guildId: interaction.guildId });
  const chunkLines = info.chunks
    .slice(0, 4)
    .map(
      (chunk) =>
        `• ${chunk.document}${chunk.section ? ` › ${chunk.section}` : ''} (${chunk.score})`,
    );
  const body = [
    `**Tema:** ${info.theme || '—'}`,
    `**Intenção:** ${info.intent || '—'}`,
    `**Follow-up:** ${info.followUp ? 'sim' : 'não'}`,
    `**Caminho:** ${info.path}`,
    info.reason ? `**Motivo:** ${info.reason}` : null,
    info.ambiguity ? `**Ambiguidade:** ${info.ambiguity.options.join(' / ')}` : null,
    info.ids.length
      ? `**Ficha:** ${info.topic || '—'} (${info.ids.join(', ')})`
      : null,
    chunkLines.length
      ? `**Busca:**\n${chunkLines.join('\n')}`
      : '**Busca:** nenhum trecho',
  ]
    .filter(Boolean)
    .join('\n');
  await interaction.editReply(
    ephemeral({ embeds: [successEmbed('Diagnóstico da IA', body)] }),
  );
}

async function handleAiChannelMessage(message) {
  try {
    if (!message.guild || message.author.bot) {
      return;
    }
    const settings = getSettings(message.guild.id);
    if (settings.admin_channel_id && message.channelId === settings.admin_channel_id) {
      return;
    }
    if (settings.farm_channel_id && message.channelId === settings.farm_channel_id) {
      return;
    }
    if (!settings.ai_channel_id || message.channelId !== settings.ai_channel_id) {
      return;
    }
    const botId = message.client.user?.id;
    const question = String(message.content || '')
      .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
      .trim();
    if (!question) {
      if (!handleAiChannelMessage.warnedEmpty) {
        console.warn(
          'Chat de IA sem conteúdo da mensagem. Ative Message Content Intent no portal do Discord.',
        );
        handleAiChannelMessage.warnedEmpty = true;
      }
      return;
    }
    if (question.startsWith('/')) {
      return;
    }
    await message.channel.sendTyping();
    const result = await answerQuestion({
      question,
      userId: message.author.id,
      guildId: message.guild.id,
      channelId: message.channelId,
      conversational: true,
    });
    await sendAiMessage(
      (payload) => message.reply(payload),
      result,
      (payload) => message.channel.send(payload),
    );
  } catch (error) {
    console.error('Erro no chat de IA:', error);
    await message
      .reply({
        content: userFacingAiError(error),
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  }
}

async function handleHelpCommand(interaction) {
  switch (interaction.options.getSubcommand()) {
    case 'pergunta':
      await handleHelpQuestion(interaction);
      break;
    case 'fontes':
      await handleHelpSources(interaction);
      break;
    case 'recarregar':
      await handleHelpReload(interaction);
      break;
    case 'canal':
      await handleHelpCanal(interaction);
      break;
    case 'limpar-historico':
      await handleHelpClear(interaction);
      break;
    case 'diagnostico':
      await handleHelpDiagnostico(interaction);
      break;
    default:
      await replyError(interaction, 'Subcomando não reconhecido.');
  }
}

module.exports = {
  helpCommand,
  handleHelpCommand,
  handleAiChannelMessage,
};
