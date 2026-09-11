const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  replaceKnowledge,
  searchKnowledge,
  searchKnowledgeLike,
  listChunksBySection,
  listKnowledgeDocuments,
} = require('./db');
const { syncPartnershipMarkdown } = require('./media');
const { reloadCatalogs, syncPriceMarkdown, getCatalog } = require('./catalogs');
const { parseQuestion } = require('./question-parse');

const rulesPath = path.resolve(process.env.RULES_PATH || './rules');
const SKIP_FILES = new Set(['readme.md', 'readme.txt']);

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function chunkText(content) {
  const parts = content.split(/(?=^#{1,3} )/m).filter((part) => part.trim());
  const chunks = [];

  for (const part of parts) {
    const headerMatch = part.match(/^#{1,3} (.+)/);
    const section = headerMatch ? headerMatch[1].trim() : 'geral';
    const body = part.trim();
    if (body.length < 20) {
      continue;
    }

    const paragraphs = body.split(/\n{2,}/);
    let current = '';
    for (const paragraph of paragraphs) {
      const next = current ? `${current}\n\n${paragraph}` : paragraph;
      if (next.length > 800 && current) {
        chunks.push({ section, content: current.trim() });
        current = paragraph;
      } else {
        current = next;
      }
    }
    if (current.trim()) {
      chunks.push({ section, content: current.trim() });
    }
  }

  return chunks;
}

function walkRuleFiles(dir, base = dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkRuleFiles(fullPath, base));
      continue;
    }
    if (!entry.isFile() || !/\.(md|txt)$/i.test(entry.name)) {
      continue;
    }
    if (SKIP_FILES.has(entry.name.toLowerCase())) {
      continue;
    }
    const content = fs
      .readFileSync(fullPath, 'utf8')
      .replace(/\u0000/g, '')
      .trim();
    files.push({
      name: path.relative(base, fullPath).split(path.sep).join('/'),
      content,
    });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function readRuleFiles() {
  if (!fs.existsSync(rulesPath)) {
    fs.mkdirSync(rulesPath, { recursive: true });
    return [];
  }
  return walkRuleFiles(rulesPath);
}

const BASE_SHORT_TERMS = new Set([
  'rdm',
  'vdm',
  'mg',
  'pg',
  'pd',
  'cl',
  'var',
  'prf',
  'qg',
  'qrr',
  'qru',
  'rk',
  'gg',
  'pf',
  'ems',
  'samu',
  'pt',
  'ice',
  'g3',
  'ak',
  'mtar',
  'evo',
  'uzi',
  'g36',
]);

const STOP_WORDS = new Set([
  'que',
  'qual',
  'quais',
  'como',
  'uma',
  'uns',
  'para',
  'pra',
  'com',
  'por',
  'pelo',
  'pela',
  'dos',
  'das',
  'nos',
  'nas',
  'isso',
  'esse',
  'essa',
  'este',
  'esta',
  'sobre',
  'regra',
  'regras',
  'oficial',
  'oficiais',
  'significa',
  'definicao',
  'explique',
  'falar',
  'fala',
  'tem',
  'ter',
  'ser',
  'sao',
  'de',
  'da',
  'do',
  'em',
  'um',
  'ao',
  'os',
  'as',
  'ou',
  'se',
  'na',
  'no',
]);

const FILLER_WORDS = new Set([
  ...STOP_WORDS,
  'poderia',
  'poderias',
  'podes',
  'pode',
  'posso',
  'podemos',
  'dizer',
  'diz',
  'diga',
  'fale',
  'explica',
  'explicar',
  'voce',
  'voces',
  'tu',
  'teu',
  'tua',
  'me',
  'meu',
  'minha',
  'mim',
  'aqui',
  'nao',
  'sim',
  'porque',
  'onde',
  'quando',
  'quem',
  'gostaria',
  'queria',
  'sabe',
  'saberia',
  'modelo',
  'tipo',
  'coisa',
  'negocio',
  'fazer',
  'feito',
  'estou',
  'esta',
  'membro',
  'deveria',
  'deveriam',
  'deveriamos',
  'devo',
  'deve',
  'devem',
  'devemos',
  'seguir',
  'segue',
  'seguem',
  'seguindo',
  'respeitar',
  'cumprir',
  'existe',
  'existem',
  'pois',
  'assim',
  'entao',
  'dessa',
  'desse',
  'neste',
  'nesta',
  'nesse',
  'nessa',
  'isto',
  'aquilo',
  'brother',
  'procedimento',
  'abordagem',
  'checagem',
  'excecao',
  'excecoes',
  'ressalva',
  'detalhe',
  'detalhes',
  'assunto',
]);

const PORTUGUESE_SHORT = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'na',
  'no',
  'nas',
  'nos',
  'em',
  'um',
  'uns',
  'uma',
  'ao',
  'aos',
  'as',
  'os',
  'ou',
  'se',
  'por',
  'com',
  'para',
  'pra',
  'que',
  'qual',
  'mais',
  'sem',
  'sob',
  'ate',
  'pelo',
  'pela',
  'sao',
  'ser',
  'tem',
  'ter',
  'nao',
  'sim',
  'ele',
  'ela',
  'seu',
  'sua',
  'the',
  'and',
  'for',
]);

let indexedShortTerms = new Set(BASE_SHORT_TERMS);

function normalizeSearchText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function collectAcronymsFromText(text) {
  const terms = new Set();
  for (const match of String(text).matchAll(/\(([A-Za-z]{2,5})\)/g)) {
    const term = normalizeSearchText(match[1]);
    if (!PORTUGUESE_SHORT.has(term)) {
      terms.add(term);
    }
  }
  for (const match of String(text).matchAll(/\*\*([A-Za-z]{2,5})\*\*/g)) {
    const term = normalizeSearchText(match[1]);
    if (!PORTUGUESE_SHORT.has(term)) {
      terms.add(term);
    }
  }
  for (const match of String(text).matchAll(/^#{1,3} (.+)$/gm)) {
    for (const token of match[1].matchAll(/\b([A-Z]{2,5})\b/g)) {
      const term = normalizeSearchText(token[1]);
      if (!PORTUGUESE_SHORT.has(term) && !STOP_WORDS.has(term)) {
        terms.add(term);
      }
    }
  }
  return terms;
}

function rebuildAcronymIndex(files) {
  indexedShortTerms = new Set(BASE_SHORT_TERMS);
  for (const file of files) {
    for (const term of collectAcronymsFromText(file.content)) {
      indexedShortTerms.add(term);
    }
  }
}

function reloadKnowledge() {
  const catalogResult = reloadCatalogs();
  const currentDocs = listKnowledgeDocuments();
  if (!catalogResult.ok) {
    return {
      indexed: currentDocs.length,
      rejected: [
        ...catalogResult.errors.map((error) => `Catálogo inválido: ${error}`),
        'Recarga recusada: os catálogos inválidos não substituíram a base anterior.',
      ],
      documents: currentDocs,
      aborted: true,
    };
  }
  syncPartnershipMarkdown();
  syncPriceMarkdown();
  const files = readRuleFiles();
  const rejected = [];
  const accepted = [];
  const hashes = new Map();

  for (const file of files) {
    if (!file.content) {
      rejected.push(`${file.name}: arquivo vazio`);
      continue;
    }
    const hash = hashContent(file.content);
    if (hashes.has(hash)) {
      rejected.push(`${file.name}: duplicado de ${hashes.get(hash)}`);
      continue;
    }
    hashes.set(hash, file.name);
    const chunks = chunkText(file.content);
    if (chunks.length === 0) {
      rejected.push(`${file.name}: sem conteúdo indexável`);
      continue;
    }
    accepted.push({
      name: file.name,
      version: 1,
      hash,
      chunks,
    });
  }

  if (accepted.length === 0 && currentDocs.length > 0) {
    return {
      indexed: currentDocs.length,
      rejected: [
        ...rejected,
        'Recarga recusada: nenhum documento válido. A base anterior foi mantida.',
      ],
      documents: currentDocs,
      aborted: true,
    };
  }

  replaceKnowledge(accepted);
  rebuildAcronymIndex(files);
  return {
    indexed: accepted.length,
    rejected,
    documents: listKnowledgeDocuments(),
  };
}

const PRICE_NOISE = new Set([
  'parceria',
  'parcerias',
  'quanto',
  'preco',
  'precos',
  'valor',
  'valores',
  'tabela',
  'custa',
  'fica',
  'sai',
  'unidade',
]);

function documentPrefixFor(question) {
  const parsed = parseQuestion(question);
  if (parsed.intent === 'clarify') {
    return null;
  }
  if (parsed.theme === 'price') {
    return '09_precos/';
  }
  if (parsed.theme === 'action') {
    return '06_acoes/';
  }
  if (parsed.theme === 'partner') {
    return '10_parcerias/';
  }
  return null;
}

function catalogTokensFor(question) {
  const parsed = parseQuestion(question);
  const extra = [];
  const catalogs = {
    prices: getCatalog('prices'),
    actions: getCatalog('actions'),
    partnerships: getCatalog('partnerships'),
  };
  for (const [kind, ids] of Object.entries(parsed.entities || {})) {
    const items = catalogs[kind] || [];
    for (const id of ids) {
      extra.push(id);
      const item = items.find((entry) => entry.id === id);
      for (const alias of item?.aliases || []) {
        extra.push(
          String(alias)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .split(/\s+/)[0],
        );
      }
    }
  }
  return extra.filter(Boolean);
}

function expandSearchTokens(tokens, question = '') {
  const seen = new Set(tokens);
  const expanded = [...tokens];
  const hasAction = tokens.some((token) =>
    ['acao', 'acoes', 'roubo', 'roubos', 'contingente', 'contigente', 'bandidos'].includes(
      token,
    ),
  );
  const synonyms = {
    contigente: ['contingente'],
    acao: ['acoes'],
    acoes: ['acao'],
    roubo: ['acao'],
    roubos: ['acoes'],
    lockpik: ['lockpick'],
    amunation: ['ammunation'],
  };
  if (hasAction) {
    synonyms.maior = ['contingente', 'maximo'];
    synonyms.menor = ['contingente', 'minimo'];
  }
  for (const token of [...tokens, ...catalogTokensFor(question)]) {
    if (!seen.has(token) && token) {
      seen.add(token);
      expanded.push(token);
    }
    for (const extra of synonyms[token] || []) {
      if (!seen.has(extra)) {
        seen.add(extra);
        expanded.push(extra);
      }
    }
  }
  return expanded.slice(0, 12);
}

function routeBoost(documentName, question) {
  const parsed = parseQuestion(question);
  const doc = normalizeSearchText(documentName);
  let boost = 0;
  const isAction = parsed.theme === 'action';
  const isPartner = parsed.theme === 'partner';
  const isPrice = parsed.theme === 'price';
  if (isAction) {
    if (doc.includes('06_acoes')) {
      boost += 14;
    }
    if (doc.includes('00_menor_contingente')) {
      boost += 18;
    }
    if (doc.includes('10_parcerias')) {
      boost -= 30;
    }
  }
  if (isPartner) {
    if (doc.includes('10_parcerias')) {
      boost += 16;
    }
    if (doc.includes('06_acoes')) {
      boost -= 10;
    }
  }
  if (isPrice) {
    if (doc.includes('09_precos')) {
      boost += 12;
    }
    if (doc.includes('10_parcerias')) {
      boost -= 20;
    }
  }
  return boost;
}

function tokenizeWords(text) {
  return normalizeSearchText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function extractTopicTerms(question) {
  const raw = String(question || '');
  const normalized = normalizeSearchText(raw);
  const seen = new Set();
  const terms = [];

  const push = (token, forceShort = false) => {
    const term = normalizeSearchText(token).replace(/[^\p{L}\p{N}]/gu, '');
    if (!term || seen.has(term) || FILLER_WORDS.has(term)) {
      return;
    }
    const keep =
      forceShort || term.length >= 4 || indexedShortTerms.has(term);
    if (!keep) {
      return;
    }
    seen.add(term);
    terms.push(term);
  };

  const whatIs = normalized.match(
    /(?:o que e|oque e|o q e|significa|definicao de)\s+(?:a |o |os |as |um |uma )?(.+)/,
  );
  if (whatIs) {
    for (const token of tokenizeWords(whatIs[1]).slice(0, 6)) {
      push(token, true);
    }
  }

  for (const match of raw.matchAll(/\b([A-Za-zÀ-ÿ]{2,5})\b/g)) {
    const original = match[1];
    const term = normalizeSearchText(original);
    const uppercase =
      original === original.toUpperCase() && /[A-ZÀ-ÿ]/.test(original);
    if (indexedShortTerms.has(term) || uppercase) {
      push(original, true);
    }
  }

  for (const token of tokenizeWords(raw)) {
    if (token.length >= 4) {
      push(token);
    }
  }

  const acronyms = terms.filter(
    (term) => indexedShortTerms.has(term) || term.length <= 3,
  );
  const rest = terms.filter((term) => !acronyms.includes(term));
  return [...acronyms, ...rest].slice(0, 8);
}

function questionHasIndexedAcronym(question) {
  return tokenizeWords(question).some((token) => indexedShortTerms.has(token));
}

function toFtsQuery(tokens, joiner = ' OR ') {
  const safe = tokens
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= 2)
    .slice(0, 8);
  if (safe.length === 0) {
    return null;
  }
  return safe.map((token) => `"${token}"`).join(joiner);
}

function hasWholeWord(haystack, token) {
  const escaped = String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

function scoreChunk(chunk, tokens, question = '') {
  const section = normalizeSearchText(chunk.section || '');
  const content = normalizeSearchText(chunk.content || '');
  const documentName = normalizeSearchText(chunk.document_name || '');
  const original = chunk.content || '';
  let score = 0;
  for (const token of tokens) {
    const escaped = String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (hasWholeWord(section, token)) {
      score += 28;
    } else if (token.length >= 4 && section.includes(token)) {
      score += 12;
    }
    if (new RegExp(`\\*\\*${escaped}\\*\\*`, 'i').test(original)) {
      score += 18;
    }
    if (hasWholeWord(content, token)) {
      score += 8;
      if (token.length <= 4) {
        if (new RegExp(`\\(${escaped}\\)`, 'i').test(original)) {
          score += 8;
        }
        if (new RegExp(`${escaped}\\s*\\(`, 'i').test(original)) {
          score += 12;
        }
        if (documentName.includes('01_geral')) {
          score += 5;
        }
      }
    } else if (token.length >= 4 && content.includes(token)) {
      score += 3;
    }
    if (hasWholeWord(documentName, token)) {
      score += 2;
    } else if (token.length >= 4 && documentName.includes(token)) {
      score += 1;
    }
  }
  if (/\*\*defini[cç][aã]o:\*\*/i.test(original) && tokens.some((token) => hasWholeWord(section, token))) {
    score += 6;
  }
  if (documentName.includes('00_indice')) {
    score -= 12;
  }
  score += routeBoost(chunk.document_name, question);
  return score;
}

function rankRows(rows, tokens, limit, question = '') {
  const ranked = rows
    .map((row) => ({ ...row, score: scoreChunk(row, tokens, question) }))
    .sort((a, b) => b.score - a.score || (a.rank || 0) - (b.rank || 0))
    .filter((row) => row.score > 0);

  const titleHits = ranked.filter((row) =>
    tokens.some((token) => {
      const section = normalizeSearchText(row.section || '');
      const escaped = String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (
        hasWholeWord(section, token) ||
        new RegExp(`\\*\\*${escaped}\\*\\*`, 'i').test(row.content || '')
      );
    }),
  );
  if (titleHits.length > 0) {
    return titleHits
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.min(limit, 4));
  }
  return ranked.filter((row) => row.score >= 6).slice(0, Math.min(limit, 4));
}

function expandToFullSections(ranked, charBudget = 6000) {
  const seen = new Set();
  const sections = [];
  for (const row of ranked) {
    const key = `${row.document_name}\0${row.section}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const parts = listChunksBySection(row.document_name, row.section);
    const content =
      parts.length > 0
        ? parts.map((part) => part.content).join('\n\n')
        : row.content;
    sections.push({
      document_name: row.document_name,
      section: row.section,
      content,
      score: row.score,
    });
  }

  const selected = [];
  let used = 0;
  for (const section of sections) {
    if (selected.length > 0 && used + section.content.length > charBudget) {
      break;
    }
    selected.push(section);
    used += section.content.length;
    if (selected.length >= 4) {
      break;
    }
  }
  return selected;
}

function applyPrefix(rows, prefix) {
  if (!prefix) {
    return rows;
  }
  return rows.filter((row) =>
    String(row.document_name || '').startsWith(prefix),
  );
}

function searchRules(question, limit = 4) {
  let tokens = expandSearchTokens(extractTopicTerms(question), question);
  const prefix = documentPrefixFor(question);
  if (prefix === '09_precos/') {
    tokens = tokens.filter((token) => !PRICE_NOISE.has(token));
  }
  if (tokens.length === 0) {
    return [];
  }

  const attempts = [
    toFtsQuery(tokens.slice(0, 4), ' OR '),
    tokens.length > 1 ? toFtsQuery(tokens, ' AND ') : null,
  ].filter(Boolean);

  let ranked = [];
  for (const query of attempts) {
    try {
      ranked = rankRows(searchKnowledge(query, 40), tokens, 12, question);
      ranked = applyPrefix(ranked, prefix);
      if (ranked.length > 0) {
        break;
      }
    } catch (error) {
      console.error('Falha na busca FTS:', error.message);
    }
  }

  if (ranked.length === 0) {
    try {
      ranked = applyPrefix(
        rankRows(searchKnowledgeLike(tokens, 40), tokens, 12, question),
        prefix,
      );
    } catch (error) {
      console.error('Falha na busca LIKE:', error.message);
      return [];
    }
  }

  if (ranked.length === 0 && prefix) {
    try {
      ranked = rankRows(
        searchKnowledge(attempts[0], 40),
        tokens,
        12,
        question,
      );
    } catch {
      ranked = [];
    }
  }

  ranked = ranked.filter(
    (row, index) => index === 0 || row.score >= ranked[0].score * 0.7,
  );

  if (
    ranked.length >= 2 &&
    ranked[0].score >= ranked[1].score * 1.8 &&
    !/\b(maior|menor|compar|e a |e o )\b/.test(normalizeSearchText(question))
  ) {
    ranked = ranked.slice(0, 1);
  }

  return expandToFullSections(ranked, 6000).slice(0, limit);
}

module.exports = {
  rulesPath,
  reloadKnowledge,
  searchRules,
  listKnowledgeDocuments,
  extractTopicTerms,
  questionHasIndexedAcronym,
  documentPrefixFor,
};
