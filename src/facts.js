const { catalogPath: getCatalogPath, getCatalog } = require('./catalogs');

const TYPO_REPLACEMENTS = [
  [/\bcontigente\b/g, 'contingente'],
  [/\blockpik\b/g, 'lockpick'],
  [/\blokpick\b/g, 'lockpick'],
  [/\bamunation\b/g, 'ammunation'],
  [/\bgalaxi\b/g, 'galaxy'],
  [/\balasca\b/g, 'alaska'],
  [/\bmacaricu\b/g, 'macarico'],
  [/\bhpilegal\b/g, 'hospital ilegal'],
];

function expandTypos(value) {
  let text = String(value || '');
  for (const [pattern, replacement] of TYPO_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function normalize(value) {
  return expandTypos(
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function hasAlias(haystack, alias) {
  const needle = normalize(alias);
  if (!needle) {
    return false;
  }
  if (needle.includes(' ')) {
    return haystack.includes(needle);
  }
  return new RegExp(`(^|[^a-z0-9])${needle}([^a-z0-9]|$)`).test(haystack);
}

function priceItems(guildId = null) {
  return getCatalog('prices', guildId);
}

function isPricePartnership(haystack) {
  return /\b(com|sem) parceria\b/.test(normalize(haystack));
}

function isPriceQuestion(text, guildId = null) {
  const haystack = normalize(text);
  if (!haystack) {
    return false;
  }
  if (isPricePartnership(haystack)) {
    return true;
  }
  if (
    /\b(preco|precos|valor|valores|tabela|quanto (custa|e|eh|fica|sai))\b/.test(
      haystack,
    )
  ) {
    return true;
  }
  return priceItems(guildId).some((item) =>
    item.aliases.some((alias) => hasAlias(haystack, alias)),
  );
}

function wantsMenor(haystack) {
  return /\b(menor|pequena|menos (gente|pessoas|membros|bandidos|pessoa)|pouca gente|poucas pessoas|precisam de menos|precisa de menos|preciso de menos)\b/.test(
    haystack,
  );
}

function wantsMaior(haystack) {
  return /\b(maior|grande|mais (gente|pessoas|membros|bandidos)|muita gente|muitas pessoas)\b/.test(
    haystack,
  );
}

function isContingenteQuestion(text) {
  const haystack = normalize(text);
  if (!haystack) {
    return false;
  }
  if (
    /\b(contingente|contigente|menor acao|maior acao|menor contingente|maior contingente)\b/.test(
      haystack,
    )
  ) {
    return true;
  }
  if (wantsMenor(haystack) && /\b(acao|acoes|roubo|pessoas|gente|membros|bandidos)\b/.test(haystack)) {
    return true;
  }
  if (wantsMaior(haystack) && /\b(acao|acoes|roubo|contingente|bandidos)\b/.test(haystack)) {
    return true;
  }
  return false;
}

function wantedBanditCount(text) {
  const haystack = normalize(text);
  const numbered =
    haystack.match(/\b(?:com|de)\s*(\d+)\b/) ||
    haystack.match(/\b(\d+)\s*(?:bandidos|pessoas|membros)\b/);
  if (!numbered) {
    return null;
  }
  const count = Number(numbered[1]);
  return Number.isInteger(count) && count > 0 && count < 100 ? count : null;
}

function wantedWeapon(text) {
  const haystack = normalize(text);
  if (/\b(fuzil|fuzis|rifle)\b/.test(haystack)) {
    return 'fuzil';
  }
  if (/\b(smg|submetralhadora|submetralhadoras)\b/.test(haystack)) {
    return 'submetralhadora';
  }
  if (/\b(pistola|pistolas)\b/.test(haystack)) {
    return 'pistola';
  }
  if (/\b(sem arma|desarmado|nenhum armamento|arma branca|soco)\b/.test(haystack)) {
    return haystack.includes('soco') || haystack.includes('branca')
      ? 'branco'
      : 'nenhum';
  }
  return null;
}

function isActionFilterQuestion(text) {
  return Boolean(wantedBanditCount(text) || wantedWeapon(text));
}

function isActionListQuestion(text) {
  const haystack = normalize(text);
  if (!/\b(acao|acoes|roubo|roubos)\b/.test(haystack)) {
    return false;
  }
  if (wantsMenor(haystack) || wantsMaior(haystack) || isActionFilterQuestion(haystack)) {
    return false;
  }
  if (
    /\bqual (a |o )?(acao|roubo)\b/.test(haystack) &&
    !/\bquais\b/.test(haystack) &&
    !/\b(todas|lista|liste|listar)\b/.test(haystack)
  ) {
    return false;
  }
  return (
    /\b(lista|liste|listar|todas|todos|tabela|elenco)\b/.test(haystack) ||
    /\bquais (sao )?(as )?(acao|acoes|roubo|roubos)\b/.test(haystack) ||
    /\b(acao|acoes) da (cidade|faccao|facção)\b/.test(haystack) ||
    /^(e )?(sobre|das) (as )?(acao|acoes)\b/.test(haystack)
  );
}

function formatPriceCard(item) {
  const lines = [`**${item.label}**`, `Tabela: ${item.group}`];
  if (item.unit) {
    lines.push(`Preço: ${item.unit}`);
  } else {
    lines.push(`Sem parceria: ${item.without}`);
    lines.push(`Com parceria: ${item.with}`);
  }
  return lines.join('\n');
}

function priceCards({ question, priorIds, guildId = null } = {}) {
  const haystack = normalize(question);
  if (!haystack) {
    return [];
  }
  const hits = priceItems(guildId).filter((item) =>
    item.aliases.some((alias) => hasAlias(haystack, alias)),
  );
  const reusePrior =
    priorIds?.length &&
    /\bparceria\b/.test(haystack) &&
    !/\b(iraque|galaxy|alaska|alasca|seita|hospital)\b/.test(haystack);
  const selected =
    hits.length > 0
      ? hits
      : reusePrior
        ? priceItems(guildId).filter((item) => priorIds.includes(item.id))
        : [];
  return selected.map((item) => ({
    kind: 'price',
    id: item.id,
    label: item.label,
    body: formatPriceCard(item),
  }));
}

function formatContingenteCard(entry) {
  return [`**${entry.title}**`, `**${entry.name}**`, entry.detail].join('\n');
}

function contingenteCards({ question, priorKind } = {}) {
  const haystack = normalize(question);
  if (!haystack) {
    return [];
  }
  const menor = wantsMenor(haystack);
  const maior = wantsMaior(haystack);
  const contingenteContext =
    isContingenteQuestion(haystack) || priorKind === 'action';
  if (!contingenteContext) {
    return [];
  }
  const ids = [];
  if (menor && !maior) {
    ids.push('menor');
  } else if (maior && !menor) {
    ids.push('maior');
  } else if (menor && maior) {
    ids.push('menor', 'maior');
  } else if (isContingenteQuestion(haystack) && priorKind !== 'action') {
    ids.push('menor', 'maior');
  } else if (priorKind === 'action' && (menor || maior)) {
    ids.push(maior ? 'maior' : 'menor');
  }
  return ids.map((id) => {
    const entry = loadActionCatalog().find(
      (action) => action.contingent?.id === id,
    );
    if (!entry) {
      return null;
    }
    return {
      kind: 'contingente',
      id,
      label: entry.contingent.title,
      body: formatContingenteCard({
        title: entry.contingent.title,
        name: entry.label,
        detail: entry.contingent.detail,
      }),
    };
  }).filter(Boolean);
}

function catalogPath() {
  return getCatalogPath('partnerships');
}

function actionCatalogPath() {
  return getCatalogPath('actions');
}

function reloadActionCatalog() {
  return loadActionCatalog();
}

function loadActionCatalog(guildId = null) {
  return getCatalog('actions', guildId);
}

function listedActions(guildId = null) {
  return loadActionCatalog(guildId).filter((entry) => entry.list !== false);
}

function matchesBanditCount(entry, count) {
  const min = Number(entry.min);
  const max = Number(entry.max ?? entry.min);
  if (!Number.isFinite(min) || min >= 1000) {
    return false;
  }
  return count >= min && count <= max;
}

function weaponLabel(weapons) {
  const map = {
    pistola: 'Pistola',
    submetralhadora: 'Submetralhadora',
    fuzil: 'Fuzil',
    branco: 'Soco ou arma branca',
    nenhum: 'Sem armamento',
  };
  return (weapons || []).map((item) => map[item] || item).join(' ou ') || '—';
}

function formatActionDetailCard(entry) {
  const lines = [
    `**${entry.label}**`,
    `Bandidos: ${entry.bandits}`,
    `Polícia: ${entry.police || '—'}`,
    `Armamento: ${weaponLabel(entry.weapons)}`,
    `Negociação: ${entry.negotiation || '—'}`,
    `Refém: ${entry.hostage || '—'}`,
  ];
  if (entry.locations?.length) {
    lines.push(`Locais: ${entry.locations.join(', ')}`);
  }
  return lines.join('\n');
}

function formatActionListCard(entries, title) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.bandits;
    const bucket = groups.get(key) || { min: entry.min, names: [] };
    bucket.names.push(entry.label);
    groups.set(key, bucket);
  }
  const lines = [
    `**${title}**`,
    'Não inclui parcerias.',
    '',
  ];
  const sorted = [...groups.entries()].sort(
    (left, right) => left[1].min - right[1].min,
  );
  for (const [label, bucket] of sorted) {
    lines.push(`**${label}:** ${bucket.names.join(', ')}`);
  }
  return lines.join('\n');
}

function actionListCards({ question, guildId = null } = {}) {
  if (!isActionListQuestion(question)) {
    return [];
  }
  const entries = listedActions(guildId);
  return [
    {
      kind: 'action',
      id: 'lista',
      label: 'Ações',
      body: formatActionListCard(entries, 'Ações oficiais (bandidos)'),
    },
  ];
}

function actionFilterCards({ question, guildId = null } = {}) {
  const haystack = normalize(question);
  if (!haystack) {
    return [];
  }
  const count = wantedBanditCount(haystack);
  const weapon = wantedWeapon(haystack);
  if (count == null && !weapon) {
    return [];
  }
  let entries = listedActions(guildId);
  if (count != null) {
    entries = entries.filter((entry) => matchesBanditCount(entry, count));
  }
  if (weapon) {
    entries = entries.filter((entry) => (entry.weapons || []).includes(weapon));
  }
  if (entries.length === 0) {
    return [];
  }
  const title =
    count != null && weapon
      ? `Ações com ${count} e ${weaponLabel([weapon]).toLowerCase()}`
      : count != null
        ? `Ações com ${count} bandidos`
        : `Ações de ${weaponLabel([weapon]).toLowerCase()}`;
  return [
    {
      kind: 'action',
      id: weapon ? `arma-${weapon}` : `contagem-${count}`,
      label: title,
      body: formatActionListCard(entries, title),
    },
  ];
}

function actionNameHits(question, guildId = null) {
  const haystack = normalize(question);
  if (!haystack) {
    return [];
  }
  return loadActionCatalog(guildId).filter((entry) =>
    (entry.aliases || []).some((alias) => hasAlias(haystack, alias)),
  );
}

function isNamedActionQuestion(text, guildId = null) {
  return actionNameHits(text, guildId).length > 0;
}

function actionDetailCards({ question, guildId = null } = {}) {
  const haystack = normalize(question);
  if (!haystack) {
    return [];
  }
  if (isActionListQuestion(haystack) || isActionFilterQuestion(haystack)) {
    return [];
  }
  if (isContingenteQuestion(haystack) && (wantsMenor(haystack) || wantsMaior(haystack))) {
    return [];
  }
  let hits = actionNameHits(haystack, guildId);
  if (hits.length === 0) {
    return [];
  }
  const groups = hits.filter((entry) => entry.group);
  if (groups.length > 0 && hits.length > groups.length) {
    hits = groups;
  }
  if (hits.length > 3) {
    return [
      {
        kind: 'action',
        id: 'nomes',
        label: 'Ações',
        body: formatActionListCard(hits, 'Ações encontradas'),
      },
    ];
  }
  return hits.map((entry) => ({
    kind: 'action',
    id: entry.id,
    label: entry.label,
    body: formatActionDetailCard(entry),
  }));
}

module.exports = {
  getPriceCatalog: priceItems,
  catalogPath,
  actionCatalogPath,
  expandTypos,
  normalize,
  hasAlias,
  isPricePartnership,
  isPriceQuestion,
  isContingenteQuestion,
  isActionListQuestion,
  isActionFilterQuestion,
  isNamedActionQuestion,
  wantedBanditCount,
  wantedWeapon,
  wantsMenor,
  wantsMaior,
  priceCards,
  contingenteCards,
  actionListCards,
  actionFilterCards,
  actionDetailCards,
  formatPriceCard,
  formatContingenteCard,
  loadActionCatalog,
  reloadActionCatalog,
};
