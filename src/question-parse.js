const { getCatalog } = require('./catalogs');
const {
  expandTypos,
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
} = require('./facts');

const RULE_CUES =
  /\b(o que e|oque e|qual (a |o )?(regra|punicao|acao)|quais (sao |as )?(regras|acoes)|proibido|permitido|denuncia|safezone|fuga|fleeca|refem|farm|punicao|metagaming|powergaming|combat logging|cop bait|dark ?rp|trash ?rp|anti ?rp|anti amor|player death|telagem|como funciona)\b/;
const PRICE_CUES =
  /\b(preco|precos|valor|valores|tabela|quanto (custa|e|eh|fica|sai)|sem parceria|com parceria|capsula|projeto|desmanche|lockpick|macarico|bloqueador|gueto|guetos|ice|lanca)\b/;
const PARTNER_CUES =
  /\b(iraque|galaxy|galaxi|alaska|alasca|parcerias|municao|lavagem|contrabando|seita|hospital ilegal|hp ilegal|mega ?mall)\b/;
const ACTION_CUES =
  /\b(acao|acoes|roubo|roubos|perimetro|contingente|contigente|bandidos|ammunation|teti)\b/;
const NEW_QUESTION =
  /^(qual|quais|quanto|onde|quando|como|quem|o que|oque|porque|por que|existe|tem como|da pra|da para)\b/;
const CONTRAST_FOLLOWUP =
  /^(e |mas |entao |então |as que |os que )|\b(maior|menor|menos pessoas|menos gente|mais pessoas|mais gente|com parceria|sem parceria|e o mapa|e o horario|e a de |e o de |e as outras|e a maior|e a menor)\b/;
const SMALL_TALK =
  /^(oi+|ola+|oie+|e ai|eae|eai|fala|salve|opa|hey|bom dia|boa tarde|boa noite|tudo bem|tudo certo|blz|beleza|suave|tranquilo|valeu|obrigado|obrigada|tmj|vlw)( tudo bem)?$/;
const IDENTITY_CHAT =
  /^(quem (e|eh) (voce|tu|vc)|que modelo tu e|qual (e )?(o )?seu nome|como (voce|tu) se chama|(como )?(eu )?posso te chamar|como te chamo|teu nome|seu nome e|voce e (um |o )?coroa|voce e (um |o )?bot|te chamo (de )?(como|coroa)?)/;
const FOLLOWUP_CHAT =
  /^(sim e voce|e voce|e tu|tudo bem e voce|beleza e voce|bora( pra onde)?|pra onde( voce)?( quer)?|e agora|e ai entao|blz entao|ah ta|ah sim|entendi|isso mesmo|fechou)$/;

function normalizeChatText(value) {
  return expandTypos(
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[!?.,;:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function matchIds(haystack, items) {
  return (items || [])
    .filter((item) =>
      (item.aliases || []).some((alias) => hasAlias(haystack, alias)),
    )
    .map((item) => item.id);
}

function isCasualMessage(value) {
  const text = normalizeChatText(value);
  return (
    SMALL_TALK.test(text) || IDENTITY_CHAT.test(text) || FOLLOWUP_CHAT.test(text)
  );
}

function isContrastFollowUp(value) {
  const text = normalizeChatText(value);
  return CONTRAST_FOLLOWUP.test(text);
}

function isRuleFollowUp(value) {
  const text = normalizeChatText(value);
  return (
    isContrastFollowUp(text) ||
    /^(mas |e |entao |então |as que |os que )/.test(text) ||
    isContingenteQuestion(text)
  );
}

function isNewStandaloneQuestion(value) {
  const text = normalizeChatText(value);
  if (isActionListQuestion(text) || isActionFilterQuestion(text)) {
    return true;
  }
  const contrastPrefix = /^(e |mas |entao |então )/.test(text);
  if (contrastPrefix && isContrastFollowUp(text)) {
    return false;
  }
  return NEW_QUESTION.test(text) || /^quanto\b/.test(text);
}

function detectAmbiguity(text) {
  const asksActions = /\b(acao|acoes|roubo|roubos)\b/.test(text);
  const asksPartners =
    /\b(parcerias|iraque|galaxy|alaska|alasca|seita)\b/.test(text) &&
    !isPricePartnership(text);
  if (asksActions && asksPartners) {
    return {
      options: ['action', 'partner'],
      prompt:
        'Você quer **as ações da cidade** ou **as parcerias (Iraque, Galaxy, Alaska, Seita)**?',
    };
  }
  return null;
}

function resolveIntent(text, entities, filters, guildId = null) {
  if (isCasualMessage(text)) {
    return 'chat';
  }
  if (isPricePartnership(text)) {
    return 'price';
  }
  if (PARTNER_CUES.test(text) || entities.partners.length > 0) {
    return 'partner';
  }
  if (isPriceQuestion(text, guildId) || entities.prices.length > 0) {
    return 'price';
  }
  if (
    ACTION_CUES.test(text) ||
    isContingenteQuestion(text) ||
    isActionListQuestion(text) ||
    isActionFilterQuestion(text) ||
    isNamedActionQuestion(text, guildId) ||
    entities.actions.length > 0 ||
    filters.contingente ||
    filters.weapon ||
    filters.banditCount != null
  ) {
    return 'action';
  }
  if (RULE_CUES.test(text)) {
    return 'rule';
  }
  return null;
}

function intentToTheme(intent) {
  if (intent === 'chat') {
    return null;
  }
  return intent;
}

function parseQuestion(question, prior = null, guildId = null) {
  const text = normalizeChatText(question);
  const entities = {
    prices: matchIds(text, getCatalog('prices', guildId)),
    actions: matchIds(text, getCatalog('actions', guildId)),
    partners: matchIds(text, getCatalog('partnerships', guildId)),
  };
  const filters = {
    banditCount: wantedBanditCount(text),
    weapon: wantedWeapon(text),
    contingente: wantsMenor(text) ? 'menor' : wantsMaior(text) ? 'maior' : null,
    partnershipPrice: isPricePartnership(text)
      ? /\bsem parceria\b/.test(text)
        ? 'sem'
        : 'com'
      : null,
  };
  const ambiguity = detectAmbiguity(text);
  const intent = ambiguity ? 'clarify' : resolveIntent(text, entities, filters, guildId);
  const themeChanged = Boolean(
    intentToTheme(intent) &&
      prior?.theme &&
      intentToTheme(intent) &&
      intentToTheme(intent) !== prior.theme &&
      intent !== 'clarify',
  );
  const followUp =
    Boolean(prior?.chunks?.length || prior?.theme) &&
    isRuleFollowUp(question) &&
    !isNewStandaloneQuestion(question) &&
    !themeChanged &&
    intent !== 'clarify';
  return {
    text,
    intent,
    theme: intentToTheme(intent),
    entities,
    filters,
    ambiguity,
    followUp,
    themeChanged,
    casual: isCasualMessage(text),
  };
}

function questionTheme(value, guildId = null) {
  return parseQuestion(value, null, guildId).theme;
}

module.exports = {
  RULE_CUES,
  PRICE_CUES,
  PARTNER_CUES,
  ACTION_CUES,
  NEW_QUESTION,
  normalizeChatText,
  isCasualMessage,
  isContrastFollowUp,
  isRuleFollowUp,
  isNewStandaloneQuestion,
  parseQuestion,
  questionTheme,
  detectAmbiguity,
};
