const fs = require('node:fs');
const path = require('node:path');
const { normalize, hasAlias, isPricePartnership } = require('./facts');
const { getCatalog: getStructuredCatalog } = require('./catalogs');

const ASSET_DIRS = [
  path.resolve(process.env.ASSETS_PATH || './assets/parcerias'),
  path.resolve('./rules/10_parcerias/mapas'),
];
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function loadCatalog(guildId = null) {
  return getStructuredCatalog('partnerships', guildId);
}

function getCatalog(guildId = null) {
  return loadCatalog(guildId);
}

function partnershipMarkdown(items = getCatalog()) {
  const lines = [
    '# Parcerias oficiais',
    '',
    'Lista oficial das parcerias da facção (fonte: `catalogo.json`). Use para dizer **quem faz o quê**, **horário** e **onde fica**.',
    '',
    'Não misture com preço “com parceria / sem parceria” das tabelas de venda.',
    '',
  ];
  for (const item of items) {
    lines.push(`## ${item.label}`, '');
    lines.push(`- **Função:** ${item.role}`);
    lines.push(`- **Horário:** ${item.hours}`);
    if (item.place) {
      lines.push(`- **Local:** ${item.place}`);
    }
    lines.push('- **Mapa:** enviado em imagem junto da resposta');
    lines.push('');
  }
  lines.push('## Como responder');
  lines.push('');
  lines.push('- Cada parceria vai em mensagem separada, com nome, função, horário e o mapa dela.');
  lines.push('- Se perguntarem de uma só, responda só dela.');
  lines.push('- Não invente coordenadas, blip ou rua. O local está no print do mapa.');
  lines.push('');
  return lines.join('\n');
}

function syncPartnershipMarkdown() {
  const items = getCatalog();
  if (items.length === 0) {
    return;
  }
  const target = path.resolve(
    process.env.RULES_PATH || './rules',
    '10_parcerias/01_parcerias.md',
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, partnershipMarkdown(items));
}

function listImageFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => {
      return entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase());
    });
  } catch {
    return [];
  }
}

function resolveImage(id, guildId = null) {
  const item = getCatalog(guildId).find((entry) => entry.id === id);
  const stems = new Set([
    id,
    `mapa-${id}`,
    `mapa_${id}`,
    `map-${id}`,
    ...(item?.imageStems || []),
  ]);
  for (const dir of ASSET_DIRS) {
    for (const entry of listImageFiles(dir)) {
      const stem = normalize(path.parse(entry.name).name).replace(/\s+/g, '-');
      if (stems.has(stem)) {
        return path.join(dir, entry.name);
      }
    }
  }
  return null;
}

function isOverview(haystack) {
  if (isPricePartnership(haystack)) {
    return false;
  }
  if (/\bparcerias\b/.test(haystack)) {
    return true;
  }
  return (
    /\bparceria\b/.test(haystack) &&
    /\b(quem|onde|mapa|horario|funcionamento|lista|quais|nossa|nossas)\b/.test(
      haystack,
    )
  );
}

function matchCatalogIds(haystack, catalog) {
  const ids = [];
  for (const item of catalog) {
    if ((item.aliases || []).some((alias) => hasAlias(haystack, alias))) {
      ids.push(item.id);
    }
  }
  if (
    /\bmunicao\b/.test(haystack) &&
    !/\bleve\b/.test(haystack) &&
    !/\bpesada\b/.test(haystack)
  ) {
    for (const id of ['iraque', 'galaxy']) {
      if (!ids.includes(id)) {
        ids.push(id);
      }
    }
  }
  if (isOverview(haystack)) {
    return catalog.map((item) => item.id);
  }
  return ids;
}

function toCard(id, catalog, guildId = null) {
  const item = catalog.find((entry) => entry.id === id);
  if (!item) {
    return null;
  }
  const filePath = resolveImage(id, guildId);
  return {
    kind: 'partnership',
    id,
    label: item.label,
    role: item.role,
    hours: item.hours,
    place: item.place || null,
    path: filePath,
    name: filePath
      ? `mapa-${id}${path.extname(filePath).toLowerCase()}`
      : null,
  };
}

function partnershipCards({ question, priorIds, guildId = null } = {}) {
  const catalog = getCatalog(guildId);
  const haystack = normalize(question);
  if (!haystack || catalog.length === 0) {
    return [];
  }
  let ids = matchCatalogIds(haystack, catalog);
  if (ids.length === 0 && priorIds?.length && /\b(mapa|horario|local|onde)\b/.test(haystack)) {
    ids = priorIds.filter((id) => catalog.some((item) => item.id === id));
  }
  const seen = new Set();
  const cards = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const card = toCard(id, catalog, guildId);
    if (card) {
      cards.push(card);
    }
  }
  return cards;
}

function formatPartnershipCard(card) {
  const lines = [
    `**${card.label}**`,
    `Função: ${card.role}`,
    `Horário: ${card.hours}`,
  ];
  if (card.place) {
    lines.push(`Local: ${card.place}`);
  }
  if (card.path) {
    lines.push('Mapa:');
  }
  return lines.join('\n');
}

function attachmentsForAi(opts) {
  return partnershipCards(opts).filter((card) => card.path);
}

module.exports = {
  getCatalog,
  partnershipMarkdown,
  syncPartnershipMarkdown,
  attachmentsForAi,
  partnershipCards,
  formatPartnershipCard,
  resolveImage,
  isPricePartnership,
};
