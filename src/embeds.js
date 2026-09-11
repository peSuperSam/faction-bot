const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const {
  displayMaterial,
  formatQuantity,
  formatPercent,
  truncate,
} = require('./util');

const COLOR = 0x8b1e3f;
const COLOR_SUCCESS = 0x2e7d32;
const COLOR_WARN = 0xc9a227;
const COLOR_ERROR = 0xc62828;
const FOOTER = 'Coroa • Farm da facção';

function withFooter(embed, period) {
  const week = period?.week?.label || period?.key || null;
  return embed.setFooter({
    text: week ? `${FOOTER} • ${week}` : FOOTER,
  });
}

function baseEmbed(title, color = COLOR) {
  return new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
}

function errorEmbed(message) {
  return withFooter(
    baseEmbed('Não foi possível concluir', COLOR_ERROR).setDescription(message),
  );
}

function successEmbed(title, description) {
  return withFooter(
    baseEmbed(title, COLOR_SUCCESS).setDescription(description),
  );
}

function infoEmbed(title, description) {
  return withFooter(baseEmbed(title).setDescription(description));
}

function registerEmbed(entry, period) {
  const lines = [
    `**${formatQuantity(entry.quantity)}x ${displayMaterial(entry.material)}**`,
    entry.note ? `Observação: ${entry.note}` : null,
    `ID do registro: \`${entry.id}\``,
    entry.status === 'pending'
      ? 'Status: pendente de validação'
      : 'Status: aprovado',
  ].filter(Boolean);
  return withFooter(
    baseEmbed('Registro salvo', COLOR_SUCCESS).setDescription(lines.join('\n')),
    period,
  );
}

function ownEntriesEmbed(rows, goals, period) {
  if (rows.length === 0) {
    return withFooter(
      baseEmbed('Seu farm da semana').setDescription(
        'Você ainda não possui registros aprovados nesta semana.',
      ),
      period,
    );
  }

  const goalByMaterial = new Map(
    goals
      .filter((goal) => goal.scope === 'user')
      .map((goal) => [goal.material, goal]),
  );
  const lines = rows.map((row) => {
    const goal = goalByMaterial.get(row.material);
    const goalText = goal
      ? ` • meta ${formatQuantity(goal.quantity)} (${formatPercent(row.total, goal.quantity)})`
      : '';
    return `• **${displayMaterial(row.material)}**: ${formatQuantity(row.total)} (${row.entries} registro(s))${goalText}`;
  });

  return withFooter(
    baseEmbed('Seu farm da semana').setDescription(lines.join('\n')),
    period,
  );
}

function rankingEmbed(rows, material, period) {
  const title = material
    ? `Ranking de ${displayMaterial(material)}`
    : 'Ranking da semana';
  if (rows.length === 0) {
    return withFooter(
      baseEmbed(title).setDescription(
        'Ainda não existem registros aprovados nesta semana.',
      ),
      period,
    );
  }
  const medals = ['1.', '2.', '3.'];
  const lines = rows.map(
    (row, index) =>
      `${medals[index] || `${index + 1}.`} **${row.user_tag}** — ${formatQuantity(row.total)}`,
  );
  return withFooter(baseEmbed(title).setDescription(lines.join('\n')), period);
}

function materialsEmbed(rows) {
  if (rows.length === 0) {
    return withFooter(
      baseEmbed('Catálogo de materiais').setDescription(
        'Nenhum material cadastrado. Use `/tdc material-adicionar`.',
      ),
    );
  }
  const lines = rows.map(
    (row) =>
      `• **${row.display_name}**${row.active ? '' : ' *(inativo)*'}`,
  );
  return withFooter(
    baseEmbed('Catálogo de materiais').setDescription(lines.join('\n')),
  );
}

function goalsEmbed(items, period) {
  if (items.length === 0) {
    return withFooter(
      baseEmbed('Metas da semana').setDescription(
        'Nenhuma meta definida para esta semana.',
      ),
      period,
    );
  }
  const lines = items.map((item) => {
    const who =
      item.scope === 'user'
        ? `membro <@${item.user_id}>`
        : 'facção';
    return `• **${displayMaterial(item.material)}** (${who}): ${formatQuantity(item.current)} / ${formatQuantity(item.quantity)} (${formatPercent(item.current, item.quantity)})`;
  });
  return withFooter(
    baseEmbed('Metas da semana').setDescription(lines.join('\n')),
    period,
  );
}

function reportEmbed({ totals, goals, absentees, period }) {
  const totalLines =
    totals.length > 0
      ? totals.map(
          (row) =>
            `• **${displayMaterial(row.material)}**: ${formatQuantity(row.total)}`,
        )
      : ['Nenhum farm aprovado nesta semana.'];

  const goalLines =
    goals.length > 0
      ? goals.map((item) => {
          const who =
            item.scope === 'user' ? `<@${item.user_id}>` : 'facção';
          return `• ${who} • **${displayMaterial(item.material)}**: ${formatPercent(item.current, item.quantity)} (${formatQuantity(item.current)}/${formatQuantity(item.quantity)})`;
        })
      : ['Nenhuma meta definida.'];

  const absenteeLine =
    absentees === null
      ? 'Configure o cargo de membro para listar quem zerou.'
      : absentees.length === 0
        ? 'Todos os membros com o cargo registraram farm nesta semana.'
        : absentees.slice(0, 20).map((member) => `• ${member}`).join('\n') +
          (absentees.length > 20 ? `\n… e mais ${absentees.length - 20}` : '');

  return withFooter(
    baseEmbed('Relatório da semana')
      .addFields(
        { name: 'Totais', value: truncate(totalLines.join('\n'), 1024) },
        { name: 'Metas', value: truncate(goalLines.join('\n'), 1024) },
        { name: 'Sem registro', value: truncate(absenteeLine, 1024) },
      ),
    period,
  );
}

function logEmbed(title, description, actor) {
  return withFooter(
    baseEmbed(title, COLOR_WARN)
      .setDescription(description)
      .addFields({ name: 'Responsável', value: `${actor}` }),
  );
}

function helpAnswerEmbed(question, answer, sources, title) {
  const embed = baseEmbed(title || 'Regras da facção').setDescription(
    truncate(answer, 3500),
  );
  if (question) {
    embed.addFields({
      name: 'Pergunta',
      value: truncate(question, 1024),
    });
  }
  if (sources.length > 0) {
    embed.addFields({
      name: 'Fontes',
      value: truncate(
        sources.map((source) => `• ${source}`).join('\n'),
        1024,
      ),
    });
  }
  return withFooter(embed);
}

function partnershipEmbed(card) {
  const lines = [`**Função:** ${card.role}`, `**Horário:** ${card.hours}`];
  if (card.place) {
    lines.push(`**Local:** ${card.place}`);
  }
  const embed = baseEmbed(card.label)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Coroa • Parcerias' });
  if (card.name) {
    embed.setImage(`attachment://${card.name}`);
  }
  return embed;
}

function sourcesEmbed(documents) {
  if (documents.length === 0) {
    return withFooter(
      baseEmbed('Base de regras').setDescription(
        'Nenhum documento indexado. Coloque arquivos `.md` ou `.txt` em `rules/` e use `/ajuda recarregar`.',
      ),
    );
  }
  const lines = documents.map(
    (doc) =>
      `• **${doc.name}** • v${doc.version} • ${doc.chunks} trecho(s) • ${doc.indexed_at}`,
  );
  return withFooter(
    baseEmbed('Documentos carregados').setDescription(lines.join('\n')),
  );
}

function farmBoardEmbed({ materials, goals, totals, period }) {
  if (materials.length === 0) {
    return withFooter(
      baseEmbed('Farm da facção').setDescription(
        'Nenhum material no catálogo. A liderança precisa cadastrar os itens.',
      ),
      period,
    );
  }

  const goalByMaterial = new Map(
    (goals || [])
      .filter((goal) => goal.scope === 'guild')
      .map((goal) => [goal.material, goal]),
  );
  const totalByMaterial = new Map(
    (totals || []).map((row) => [row.material, Number(row.total || 0)]),
  );
  const lines = materials.map((material) => {
    const current = totalByMaterial.get(material.name) || 0;
    const goal = goalByMaterial.get(material.name);
    if (goal) {
      return `**${material.display_name}**\n${formatQuantity(current)} / ${formatQuantity(goal.quantity)} • ${formatPercent(current, goal.quantity)}`;
    }
    return `**${material.display_name}**\n${formatQuantity(current)} farmado • meta ainda não definida`;
  });

  return withFooter(
    baseEmbed('Farm da facção').setDescription(
      [
        'Escolha o material no menu para lançar. Ranking e seus registros aparecem só para você.',
        '',
        ...lines,
      ].join('\n'),
    ),
    period,
  );
}

function farmBoardComponents(materials) {
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('farm:panel:ranking')
      .setLabel('Ranking')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('farm:panel:mine')
      .setLabel('Meus registros')
      .setStyle(ButtonStyle.Secondary),
  );

  const rows = [buttons];
  if (materials.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('farm:select:material')
          .setPlaceholder('Registrar farm…')
          .addOptions(
            materials.slice(0, 25).map((material) => ({
              label: material.display_name.slice(0, 100),
              value: String(material.id),
            })),
          ),
      ),
    );
  }
  return rows;
}

function staffPanelEmbed({ period, farmChannelId, goals }) {
  const farmLine = farmChannelId
    ? `Painel da facção: <#${farmChannelId}>`
    : 'Painel da facção ainda não publicado. Use **Atualizar painel** ou `/tdc publicar`.';
  const guildGoals = (goals || []).filter((goal) => goal.scope === 'guild');
  const goalLines =
    guildGoals.length > 0
      ? guildGoals.map(
          (goal) =>
            `• **${displayMaterial(goal.material)}**: ${formatQuantity(goal.current || 0)} / ${formatQuantity(goal.quantity)} (${formatPercent(goal.current, goal.quantity)})`,
        )
      : ['Nenhuma meta definida. Use **Definir metas**.'];

  return withFooter(
    baseEmbed('Painel da administração').setDescription(
      [
        farmLine,
        '',
        '**Metas da semana**',
        ...goalLines,
        '',
        'Apelido: `/tdc apelido` • Correção: `/tdc corrigir` / `/tdc apagar`',
      ].join('\n'),
    ),
    period,
  );
}

function staffPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tdc:staff:metas')
        .setLabel('Definir metas')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('tdc:staff:publicar')
        .setLabel('Atualizar painel')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('tdc:staff:relatorio')
        .setLabel('Relatório')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('tdc:staff:validar')
        .setLabel('Validar')
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

function pendingEmbed(entries, period) {
  if (entries.length === 0) {
    return withFooter(
      baseEmbed('Validação').setDescription(
        'Não há registros pendentes. Novos lançamentos entram aprovados automaticamente; use `/tdc corrigir` ou `/tdc apagar` para auditar.',
      ),
      period,
    );
  }
  const lines = entries.map(
    (entry) =>
      `• \`#${entry.id}\` <@${entry.user_id}> — ${formatQuantity(entry.quantity)}x ${displayMaterial(entry.material)}`,
  );
  return withFooter(
    baseEmbed('Registros pendentes').setDescription(lines.join('\n')),
    period,
  );
}

function panelComponents(materials) {
  return farmBoardComponents(materials);
}

function confirmDeleteComponents(entryId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`farm:delete:yes:${entryId}`)
        .setLabel('Confirmar exclusão')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`farm:delete:no:${entryId}`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function pendingActionComponents(entries) {
  return entries.slice(0, 5).map(
    (entry) =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`farm:validate:approve:${entry.id}`)
          .setLabel(`Aprovar #${entry.id}`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`farm:validate:reject:${entry.id}`)
          .setLabel(`Rejeitar #${entry.id}`)
          .setStyle(ButtonStyle.Danger),
      ),
  );
}

function ephemeral(payload) {
  return {
    allowedMentions: { parse: [] },
    ...payload,
    flags: MessageFlags.Ephemeral,
  };
}

module.exports = {
  COLOR,
  errorEmbed,
  successEmbed,
  infoEmbed,
  registerEmbed,
  ownEntriesEmbed,
  rankingEmbed,
  materialsEmbed,
  goalsEmbed,
  reportEmbed,
  logEmbed,
  helpAnswerEmbed,
  partnershipEmbed,
  sourcesEmbed,
  farmBoardEmbed,
  farmBoardComponents,
  staffPanelEmbed,
  staffPanelComponents,
  panelEmbed: farmBoardEmbed,
  pendingEmbed,
  panelComponents,
  confirmDeleteComponents,
  pendingActionComponents,
  ephemeral,
};
