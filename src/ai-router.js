const {
  searchRules,
  extractTopicTerms,
  questionHasIndexedAcronym,
} = require('./knowledge');
const { partnershipCards, formatPartnershipCard } = require('./media');
const {
  isPricePartnership,
  isContingenteQuestion,
  isActionListQuestion,
  isActionFilterQuestion,
  isNamedActionQuestion,
  priceCards,
  contingenteCards,
  actionListCards,
  actionFilterCards,
  actionDetailCards,
} = require('./facts');
const {
  PRICE_CUES,
  PARTNER_CUES,
  ACTION_CUES,
  RULE_CUES,
  normalizeChatText,
  isCasualMessage,
  isContrastFollowUp,
  isRuleFollowUp,
  isNewStandaloneQuestion: isBaseStandaloneQuestion,
  parseQuestion,
  questionTheme,
} = require('./question-parse');

function isNewStandaloneQuestion(value) {
  if (isBaseStandaloneQuestion(value)) {
    return true;
  }
  const text = normalizeChatText(value);
  const contrastPrefix = /^(e |mas |entao |então )/.test(text);
  if (
    contrastPrefix &&
    isContrastFollowUp(text) &&
    RULE_CUES.test(text) &&
    questionHasIndexedAcronym(value)
  ) {
    return true;
  }
  return false;
}

function looksLikeRuleQuestion(value, priorRule) {
  if (isCasualMessage(value)) {
    return false;
  }
  if (questionHasIndexedAcronym(value)) {
    return true;
  }
  const parsed = parseQuestion(value, priorRule);
  if (
    parsed.intent === 'price' ||
    parsed.intent === 'partner' ||
    parsed.intent === 'action' ||
    parsed.intent === 'rule' ||
    parsed.intent === 'clarify'
  ) {
    return true;
  }
  const text = parsed.text;
  if (NEW_QUESTION_HINT(text) && extractTopicTerms(value).length > 0) {
    return true;
  }
  if (
    priorRule &&
    (isRuleFollowUp(value) || isContrastFollowUp(value)) &&
    !isNewStandaloneQuestion(value)
  ) {
    return true;
  }
  const topics = extractTopicTerms(value);
  if (RULE_CUES.test(text) && topics.length > 0) {
    return true;
  }
  return /(o que e|oque e|significa)/.test(text) && topics.length > 0;
}

function NEW_QUESTION_HINT(text) {
  return /^(qual|quais|quanto|onde|quando|como|quem|o que|oque|porque|por que|existe|tem como|da pra|da para)\b/.test(
    text,
  );
}

function structuredHit(theme, cards, sources, topic) {
  return {
    theme,
    cards,
    sources,
    topic,
    chunks: cards.map((card) => ({
      document_name: sources[0],
      section: card.label,
      content:
        theme === 'partner' ? formatPartnershipCard(card) : card.body,
    })),
  };
}

function clarifyHit(ambiguity) {
  return {
    theme: 'clarify',
    cards: [
      {
        kind: 'clarify',
        id: 'clarify',
        label: 'Confirmação',
        body: ambiguity.prompt,
      },
    ],
    sources: [],
    topic: 'Confirmação',
    chunks: [],
  };
}

function resolveStructuredCards({ question, prior, followUp }) {
  const parsed = parseQuestion(question, followUp ? prior : null);
  const activePrior = followUp ? prior : null;

  if (parsed.ambiguity) {
    return clarifyHit(parsed.ambiguity);
  }

  if (!isPricePartnership(parsed.text)) {
    const partnerAsk =
      PARTNER_CUES.test(parsed.text) ||
      parsed.entities.partners.length > 0 ||
      (followUp &&
        activePrior?.theme === 'partner' &&
        /\b(mapa|horario|horarios|local|onde|seita|iraque|galaxy|alaska|alasca)\b/.test(
          parsed.text,
        ));
    if (partnerAsk) {
      const cards = partnershipCards({
        question,
        priorIds: activePrior?.ids,
      });
      if (cards.length > 0) {
        return structuredHit(
          'partner',
          cards,
          ['10_parcerias/catalogo.json'],
          cards.length === 1 ? cards[0].label : 'Parcerias',
        );
      }
    }
  }

  const priceHits = priceCards({
    question,
    priorIds: activePrior?.theme === 'price' ? activePrior.ids : [],
  });
  if (
    priceHits.length > 0 &&
    (parsed.theme === 'price' || (followUp && activePrior?.theme === 'price'))
  ) {
    return structuredHit(
      'price',
      priceHits,
      ['09_precos'],
      priceHits.length === 1 ? priceHits[0].label : 'Preços',
    );
  }

  const contingenteHits = contingenteCards({
    question,
    priorKind: activePrior?.theme,
  });
  if (
    contingenteHits.length > 0 &&
    (parsed.theme === 'action' ||
      isContingenteQuestion(question) ||
      (followUp && activePrior?.theme === 'action'))
  ) {
    return structuredHit(
      'action',
      contingenteHits,
      ['06_acoes/00_menor_contingente.md'],
      contingenteHits.length === 1
        ? contingenteHits[0].label
        : 'Contingente',
    );
  }

  const filterHits = actionFilterCards({ question });
  if (
    filterHits.length > 0 &&
    (parsed.theme === 'action' || isActionFilterQuestion(question))
  ) {
    return structuredHit(
      'action',
      filterHits,
      ['06_acoes/catalogo.json'],
      filterHits[0].label,
    );
  }

  const detailHits = actionDetailCards({ question });
  if (
    detailHits.length > 0 &&
    (parsed.theme === 'action' || isNamedActionQuestion(question))
  ) {
    return structuredHit(
      'action',
      detailHits,
      ['06_acoes/catalogo.json'],
      detailHits.length === 1 ? detailHits[0].label : 'Ações',
    );
  }

  const listHits = actionListCards({ question });
  if (listHits.length > 0) {
    return structuredHit(
      'action',
      listHits,
      ['06_acoes/catalogo.json'],
      'Ações',
    );
  }

  return null;
}

function formatStructuredAnswer(hit) {
  if (hit.theme === 'partner') {
    return hit.cards.map((card) => formatPartnershipCard(card)).join('\n\n');
  }
  return hit.cards.map((card) => card.body).join('\n\n');
}

function isWeakSearch(chunks, theme) {
  if (!chunks?.length) {
    return true;
  }
  const top = chunks[0];
  if (Number(top.score || 0) > 0 && Number(top.score) < 6) {
    return true;
  }
  const doc = String(top.document_name || '');
  if (theme === 'action' && !doc.startsWith('06_acoes')) {
    return true;
  }
  if (theme === 'price' && !doc.startsWith('09_precos')) {
    return true;
  }
  if (theme === 'partner' && !doc.startsWith('10_parcerias')) {
    return true;
  }
  if (
    theme === 'rule' &&
    (doc.startsWith('10_parcerias') || doc.startsWith('09_precos'))
  ) {
    return true;
  }
  return false;
}

function inspectQuestion({ question, prior = null } = {}) {
  const parsed = parseQuestion(question, prior);
  const themeNow = parsed.theme;
  const themeChanged = Boolean(
    themeNow && prior?.theme && themeNow !== prior.theme,
  );
  const followUp =
    Boolean(prior?.chunks?.length || prior?.theme) &&
    isRuleFollowUp(question) &&
    !isNewStandaloneQuestion(question) &&
    !themeChanged &&
    parsed.intent !== 'clarify';
  const structured = resolveStructuredCards({
    question,
    prior: followUp ? prior : null,
    followUp,
  });
  const searchQuery = followUp
    ? `${prior?.query || prior?.topic || ''} ${question}`.trim()
    : question;
  const chunks = searchRules(searchQuery, 4);
  let path = 'rag';
  let reason = 'busca nos trechos oficiais';
  if (parsed.intent === 'clarify' || structured?.theme === 'clarify') {
    path = 'desambiguacao';
    reason = parsed.ambiguity?.prompt || 'pergunta ambígua';
  } else if (structured) {
    path = `ficha:${structured.theme}`;
    reason = `ficha determinística (${structured.theme})`;
  } else if (isWeakSearch(chunks, themeNow)) {
    path = 'recusa';
    reason = chunks.length
      ? 'trecho incompatível com o tema'
      : 'nenhum trecho suficiente';
  }
  return {
    theme: themeNow,
    intent: parsed.intent,
    followUp,
    path,
    reason,
    ambiguity: parsed.ambiguity,
    entities: parsed.entities,
    filters: parsed.filters,
    topic: structured?.topic || null,
    ids: structured?.cards?.map((card) => card.id) || [],
    chunks: chunks.map((chunk) => ({
      document: chunk.document_name,
      section: chunk.section || '',
      score: Number(chunk.score || 0),
    })),
  };
}

module.exports = {
  PRICE_CUES,
  PARTNER_CUES,
  ACTION_CUES,
  normalizeChatText,
  isCasualMessage,
  isRuleFollowUp,
  isNewStandaloneQuestion,
  questionTheme,
  looksLikeRuleQuestion,
  resolveStructuredCards,
  formatStructuredAnswer,
  isWeakSearch,
  inspectQuestion,
  parseQuestion,
};
