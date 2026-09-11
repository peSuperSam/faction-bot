const fs = require('node:fs');
const path = require('node:path');

const CATALOG_FILES = {
  prices: '09_precos/catalogo.json',
  actions: '06_acoes/catalogo.json',
  partnerships: '10_parcerias/catalogo.json',
};

let cachedCatalogs = null;

function rulesRoot() {
  return path.resolve(process.env.RULES_PATH || './rules');
}

function catalogPath(name) {
  const relativePath = CATALOG_FILES[name];
  if (!relativePath) {
    throw new Error(`Catálogo desconhecido: ${name}`);
  }
  return path.join(rulesRoot(), relativePath);
}

function readCatalogFile(name) {
  const file = catalogPath(name);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return {
      value: null,
      errors: [`${CATALOG_FILES[name]}: JSON inválido (${error.message})`],
    };
  }
  return { value: parsed, errors: [] };
}

function validateCommon(items, name) {
  const errors = [];
  if (!Array.isArray(items) || items.length === 0) {
    return [`${CATALOG_FILES[name]}: deve ser uma lista não vazia`];
  }
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    const prefix = `${CATALOG_FILES[name]}[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${prefix}: deve ser um objeto`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(String(item.id || ''))) {
      errors.push(`${prefix}.id: formato inválido`);
    } else if (ids.has(item.id)) {
      errors.push(`${prefix}.id: duplicado (${item.id})`);
    } else {
      ids.add(item.id);
    }
    if (!String(item.label || '').trim()) {
      errors.push(`${prefix}.label: obrigatório`);
    }
    if (
      !Array.isArray(item.aliases) ||
      item.aliases.length === 0 ||
      item.aliases.some((alias) => !String(alias || '').trim())
    ) {
      errors.push(`${prefix}.aliases: deve conter pelo menos um alias válido`);
    }
  }
  return errors;
}

function validatePrices(items) {
  const errors = validateCommon(items, 'prices');
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const prefix = `09_precos/catalogo.json[${index}]`;
    const hasUnit = String(item.unit || '').trim() !== '';
    const hasPartnershipPrices =
      String(item.without || '').trim() !== '' &&
      String(item.with || '').trim() !== '';
    if (!hasUnit && !hasPartnershipPrices) {
      errors.push(`${prefix}: informe unit ou without/with`);
    }
    if (hasUnit && hasPartnershipPrices) {
      errors.push(`${prefix}: unit não pode ser combinado com without/with`);
    }
    if (!String(item.group || '').trim()) {
      errors.push(`${prefix}.group: obrigatório`);
    }
  }
  return errors;
}

function validateActions(items) {
  const errors = validateCommon(items, 'actions');
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const prefix = `06_acoes/catalogo.json[${index}]`;
    const min = Number(item.min);
    const max = Number(item.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
      errors.push(`${prefix}: min/max inválidos`);
    }
    for (const field of ['bandits', 'police', 'negotiation', 'hostage']) {
      if (!String(item[field] || '').trim()) {
        errors.push(`${prefix}.${field}: obrigatório`);
      }
    }
    if (!Array.isArray(item.weapons) || item.weapons.length === 0) {
      errors.push(`${prefix}.weapons: deve conter pelo menos uma arma`);
    }
    if (item.contingent) {
      if (!String(item.contingent.id || '').trim()) {
        errors.push(`${prefix}.contingent.id: obrigatório`);
      }
      if (!String(item.contingent.title || '').trim()) {
        errors.push(`${prefix}.contingent.title: obrigatório`);
      }
      if (!String(item.contingent.detail || '').trim()) {
        errors.push(`${prefix}.contingent.detail: obrigatório`);
      }
    }
  }
  return errors;
}

function validatePartnerships(items) {
  const errors = validateCommon(items, 'partnerships');
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const prefix = `10_parcerias/catalogo.json[${index}]`;
    for (const field of ['role', 'hours']) {
      if (!String(item[field] || '').trim()) {
        errors.push(`${prefix}.${field}: obrigatório`);
      }
    }
    if (item.imageStems && !Array.isArray(item.imageStems)) {
      errors.push(`${prefix}.imageStems: deve ser uma lista`);
    }
  }
  return errors;
}

function readAndValidateCatalogs() {
  const validators = {
    prices: validatePrices,
    actions: validateActions,
    partnerships: validatePartnerships,
  };
  const catalogs = {};
  const errors = [];
  for (const name of Object.keys(CATALOG_FILES)) {
    const result = readCatalogFile(name);
    errors.push(...result.errors);
    catalogs[name] = result.value;
    if (result.value !== null) {
      errors.push(...validators[name](result.value));
    }
  }
  return { catalogs, errors };
}

function reloadCatalogs() {
  const result = readAndValidateCatalogs();
  if (result.errors.length > 0) {
    return { ok: false, errors: result.errors, catalogs: cachedCatalogs };
  }
  cachedCatalogs = result.catalogs;
  return { ok: true, errors: [], catalogs: cachedCatalogs };
}

function getCatalog(name) {
  if (!cachedCatalogs) {
    const result = reloadCatalogs();
    if (!result.ok) {
      return [];
    }
  }
  return cachedCatalogs[name] || [];
}

function priceMarkdown(items, title, groups) {
  const lines = [`# ${title}`, '', 'Dados oficiais gerados de `catalogo.json`.', ''];
  for (const group of groups) {
    const selected = items.filter((item) => item.group === group);
    if (selected.length === 0) {
      continue;
    }
    lines.push(`## ${group}`, '');
    for (const item of selected) {
      lines.push(`- **${item.label}**`);
      if (item.unit) {
        lines.push(`  - Preço: ${item.unit}`);
      } else {
        lines.push(`  - Sem parceria: ${item.without}`);
        lines.push(`  - Com parceria: ${item.with}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function syncPriceMarkdown() {
  const items = getCatalog('prices');
  if (items.length === 0) {
    return;
  }
  const directory = path.join(rulesRoot(), '09_precos');
  const files = [
    [
      '01_valores_guetos.md',
      priceMarkdown(items, 'Valores Guetos', ['Valores Guetos']),
    ],
    [
      '02_desmanche.md',
      priceMarkdown(items, 'Tabela de preço Desmanche', ['Desmanche']),
    ],
    [
      '03_arma_leve_e_ice.md',
      priceMarkdown(items, 'Tabela de preço Arma leve e ICE', [
        'Arma leve',
        'ICE',
      ]),
    ],
    [
      '04_arma_pesada_e_lanca.md',
      priceMarkdown(items, 'Tabela de preço Arma pesada e lança', [
        'Arma pesada',
        'Lança',
      ]),
    ],
  ];
  for (const [name, content] of files) {
    fs.writeFileSync(path.join(directory, name), content);
  }
}

module.exports = {
  CATALOG_FILES,
  catalogPath,
  getCatalog,
  reloadCatalogs,
  readAndValidateCatalogs,
  validatePrices,
  validateActions,
  validatePartnerships,
  syncPriceMarkdown,
};
