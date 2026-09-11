const { logAi, countKnowledgeChunks } = require('./db');
const { acquireAiSlot, assertQuestionSize, noteAiRequest } = require('./ai-limit');
const {
  appendAiContext,
  listAiContext,
  getAiContextTopic,
  setAiContextTopic,
} = require('./user-context');
const {
  searchRules,
  listKnowledgeDocuments,
  extractTopicTerms,
} = require('./knowledge');
const { truncate } = require('./util');
const {
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
  parseQuestion,
} = require('./ai-router');
const {
  isContingenteQuestion,
  isActionListQuestion,
  isActionFilterQuestion,
  isNamedActionQuestion,
} = require('./facts');
const llm = require('./ai-llm');

const SYSTEM_PROMPT = `Você é o Coroa, assistente oficial de regras de uma facção de GTA RP.
Responda em português brasileiro, de forma direta, objetiva e respeitosa.
Use exclusivamente os TRECHOS OFICIAIS enviados nesta conversa.

Como responder:
- Entregue a definição e as exceções/procedimentos que estiverem nos trechos, juntos.
- Quando houver "**Definição:**", use-a como resposta principal e inclua as exceções do mesmo trecho.
- Não diga que a informação está incompleta, vaga ou ausente se os trechos já explicam o assunto.
- Não peça para consultar um líder quando a regra já está escrita nos trechos.
- Não invente regras, punições, prazos, cargos ou exceções que não apareçam nos trechos.
- Se nenhum trecho tratar da pergunta, responda só: Não localizado nas regras carregadas.
- Se a pergunta for de preço/tabela, informe os valores com e sem parceria quando existirem no trecho.
- Se a pergunta for de ação, roubo, perímetro ou contingente, use os trechos de ações. Não misture com parcerias. Lavagem e hospital ilegal são parcerias, não ações.
- Se a pergunta for de parceria (Iraque, Galaxy, Alaska, Seita, munição, lavagem, contrabando, hospital ilegal), use o trecho de parcerias.
- Não cite arquivo, pasta, seção nem fontes.`;

const SYSTEM_PROMPT_CHAT = `Você é o Coroa, assistente da facção no Discord. Fale em português brasileiro, próximo e direto, como alguém da casa — sem gíria forçada e sem erro técnico.
Você se chama Coroa. Se perguntarem seu nome, como te chamar ou quem você é: responda em 1 frase, no tom da casa. Não cite regras, arquivos, fontes nem embeds.
Se for saudação ou papo solto ("bora", "e agora", "pra onde"): 1 ou 2 frases curtas. Convide a mandar a dúvida (regra, preço, RP). Não invente missão nem roleplay longo.
Se for dúvida de regra, preço/tabela ou parceria (Iraque, Galaxy, Alaska, Seita, munição, lavagem, hospital ilegal, mapa, horário): use só os TRECHOS OFICIAIS. Diga o valor com e sem parceria quando o trecho tiver os dois. Não invente preço.
Se a pergunta continuar o mesmo assunto ("essa regra", "e o de parceria", "e a capsula", "e o mapa", "e o horario"), NÃO troque de tema e NÃO peça outro trecho.
Se a mensagem for uma pergunta NOVA (qual, quanto, onde, como, qual ação), IGNORE o assunto anterior. Não fale de parcerias nem envie mapa se a pergunta não citar Iraque, Galaxy, Alaska, Seita, munição, lavagem, hospital ilegal ou parcerias.
Não misture ação/roubo com parceria. Lavagem e hospital ilegal não são ações.
Use só o histórico DESTE membro (mesmo ID).
Se for dúvida de regra/preço e não houver trecho: uma frase simples pedindo o nome do item ou da regra, sem repetir a pergunta inteira entre aspas.
Não execute comandos, não altere registros e não conceda permissões.`;

function getLastRule(channelId, userId, guildId) {
  return getAiContextTopic({ guildId, userId, channelId });
}

function saveLastRule(channelId, userId, guildId, payload) {
  return setAiContextTopic({
    guildId,
    userId,
    channelId,
    topic: payload.topic,
    query: payload.query,
    chunks: payload.chunks,
    theme: payload.theme,
    ids: payload.ids,
  });
}

function remember(guildId, userId, channelId, role, content) {
  if (!userId) {
    return Promise.resolve();
  }
  return appendAiContext({
    guildId,
    userId,
    channelId,
    role,
    content: truncate(content, 400),
  });
}

async function rememberTopic({
  channelId,
  userId,
  guildId,
  question,
  prior,
  followUp,
  topic,
  chunks,
  theme,
  ids,
}) {
  await saveLastRule(channelId, userId, guildId, {
    query: followUp ? prior?.query || question : question,
    topic,
    chunks,
    theme,
    ids,
  });
}

function uniqueSources(chunks) {
  const seen = new Set();
  const sources = [];
  for (const chunk of chunks) {
    const label = chunk.section
      ? `${chunk.document_name} › ${chunk.section}`
      : chunk.document_name;
    if (!seen.has(label)) {
      seen.add(label);
      sources.push(label);
    }
  }
  return sources;
}

function embedTitleFromChunks(chunks) {
  const section = String(chunks[0]?.section || '').trim();
  if (!section) {
    return 'Regras da facção';
  }
  const withoutNum = section.replace(/^\d+\.\s*/, '');
  const acronym = withoutNum.match(/^([A-Z]{2,5})(?:\s|\(|$)/);
  if (acronym && withoutNum.includes('(')) {
    return acronym[1];
  }
  return withoutNum.slice(0, 80) || 'Regras da facção';
}

function topicLabel(chunks, fallback) {
  if (chunks?.[0]?.section) {
    return embedTitleFromChunks(chunks);
  }
  return fallback || 'esta regra';
}

function notFoundAnswer(question, conversational = false) {
  if (conversational) {
    return 'Não achei isso nas regras nem na tabela de preços. Manda o nome do item ou da regra direito que eu busco.';
  }
  const term = truncate(String(question || '').replace(/\s+/g, ' ').trim(), 80);
  return `Não localizei "${term}" nas regras carregadas.`;
}

function validateGeneratedAnswer(answer, { chunks = [], casual = false } = {}) {
  const text = String(answer || '').trim();
  if (!text) {
    return { ok: false, reason: 'empty', answer: '' };
  }
  if (!casual && /09_precos\/|10_parcerias\/|06_acoes\//i.test(text)) {
    return {
      ok: true,
      reason: 'trimmed-paths',
      answer: text
        .replace(/[^\s]*09_precos\/[^\s]*/gi, '')
        .replace(/[^\s]*10_parcerias\/[^\s]*/gi, '')
        .replace(/[^\s]*06_acoes\/[^\s]*/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    };
  }
  if (!casual && chunks.length === 0 && /\$\d/.test(text)) {
    return { ok: false, reason: 'ungrounded-price', answer: text };
  }
  const sourceText = chunks.map((chunk) => chunk.content || '').join('\n');
  if (!casual && /\$\d/.test(text) && !/\$\d/.test(sourceText)) {
    return { ok: false, reason: 'invented-price', answer: text };
  }
  return { ok: true, reason: 'ok', answer: truncate(text, 1900) };
}

function logOutcome(payload) {
  logAi({
    guildId: payload.guildId,
    userId: payload.userId,
    question: truncate(payload.question, 500),
    answer: truncate(payload.answer || '', 4000),
    sources: payload.sources || [],
    theme: payload.theme || null,
    path: payload.path || null,
    latencyMs: payload.latencyMs || 0,
    outcome: payload.outcome || 'ok',
  });
}

async function answerQuestion({
  question,
  userId,
  guildId,
  channelId,
  conversational = false,
}) {
  const started = Date.now();
  assertQuestionSize(question);
  noteAiRequest(userId);
  const documents = listKnowledgeDocuments();
  const prior = getLastRule(channelId, userId, guildId);
  const parsed = parseQuestion(question, prior);
  const topics = extractTopicTerms(question);
  const themeNow = parsed.theme || questionTheme(question);
  const themeChanged = Boolean(
    themeNow && prior?.theme && themeNow !== prior.theme,
  );
  const followUp =
    Boolean(prior?.chunks?.length || prior?.theme) &&
    isRuleFollowUp(question) &&
    !isNewStandaloneQuestion(question) &&
    !themeChanged &&
    parsed.intent !== 'clarify';
  const activePrior = followUp ? prior : null;
  const wantsKnowledge = looksLikeRuleQuestion(question, activePrior || prior);
  const casual =
    conversational && (isCasualMessage(question) || (!wantsKnowledge && !followUp));
  const ruleQuestion = !conversational || (!casual && wantsKnowledge);
  const searchQuery = followUp
    ? `${activePrior.query || activePrior.topic || ''} ${question}`.trim()
    : question;
  const shouldSearch =
    !casual &&
    ruleQuestion &&
    documents.length > 0 &&
    parsed.intent !== 'clarify' &&
    (followUp ||
      topics.length > 0 ||
      PRICE_CUES.test(normalizeChatText(question)) ||
      PARTNER_CUES.test(normalizeChatText(question)) ||
      ACTION_CUES.test(normalizeChatText(question)) ||
      isContingenteQuestion(question) ||
      isActionListQuestion(question) ||
      isActionFilterQuestion(question) ||
      isNamedActionQuestion(question));
  let chunks = shouldSearch ? searchRules(searchQuery, followUp ? 4 : 3) : [];
  if (isWeakSearch(chunks, themeNow)) {
    if (
      followUp &&
      activePrior?.chunks?.length &&
      !isWeakSearch(activePrior.chunks, themeNow || activePrior.theme)
    ) {
      chunks = activePrior.chunks;
    } else {
      chunks = [];
    }
  }

  const latency = () => Date.now() - started;

  if (!casual) {
    const structured = resolveStructuredCards({
      question,
      prior: activePrior,
      followUp,
    });
    if (structured) {
      const answer = formatStructuredAnswer(structured);
      const outcome = structured.theme === 'clarify' ? 'clarify' : 'ficha';
      logOutcome({
        guildId,
        userId,
        question,
        answer,
        sources: structured.sources,
        theme: structured.theme,
        path: `ficha:${structured.theme}`,
        latencyMs: latency(),
        outcome,
      });
      await remember(guildId, userId, channelId, 'user', question);
      await remember(guildId, userId, channelId, 'assistant', answer);
      await rememberTopic({
        channelId,
        userId,
        guildId,
        question,
        prior: activePrior,
        followUp,
        topic: structured.topic,
        chunks: structured.chunks,
        theme: structured.theme,
        ids: structured.cards.map((card) => card.id),
      });
      return {
        answer,
        sources: structured.sources,
        found: structured.theme !== 'clarify',
        useEmbed: false,
        embedTitle: null,
        attachments: [],
        cards: structured.cards,
        path: `ficha:${structured.theme}`,
        outcome,
      };
    }
  }

  if (!conversational && documents.length === 0) {
    const answer =
      'Não localizado nas regras carregadas. A liderança ainda não indexou os arquivos oficiais.';
    logOutcome({
      guildId,
      userId,
      question,
      answer,
      theme: themeNow,
      path: 'catalogo',
      latencyMs: latency(),
      outcome: 'catalog',
    });
    return {
      answer,
      sources: [],
      found: false,
      useEmbed: true,
      embedTitle: 'Regras da facção',
      attachments: [],
      path: 'catalogo',
      outcome: 'catalog',
    };
  }

  if (!conversational && chunks.length === 0) {
    console.warn('IA sem trechos', {
      question,
      documents: documents.length,
      chunks: countKnowledgeChunks(),
    });
    const answer = notFoundAnswer(question);
    logOutcome({
      guildId,
      userId,
      question,
      answer,
      theme: themeNow,
      path: 'recusa',
      latencyMs: latency(),
      outcome: 'miss',
    });
    return {
      answer,
      sources: [],
      found: false,
      useEmbed: true,
      embedTitle: 'Regras da facção',
      attachments: [],
      path: 'recusa',
      outcome: 'miss',
    };
  }

  if (conversational && ruleQuestion && chunks.length === 0) {
    const answer = notFoundAnswer(question, true);
    logOutcome({
      guildId,
      userId,
      question,
      answer,
      theme: themeNow,
      path: 'recusa',
      latencyMs: latency(),
      outcome: 'miss',
    });
    await remember(guildId, userId, channelId, 'user', question);
    await remember(guildId, userId, channelId, 'assistant', answer);
    return {
      answer,
      sources: [],
      found: false,
      useEmbed: false,
      embedTitle: null,
      attachments: [],
      path: 'recusa',
      outcome: 'miss',
    };
  }

  const context =
    chunks.length > 0
      ? chunks
          .map(
            (chunk, index) =>
              `[Trecho ${index + 1} | ${chunk.document_name}${
                chunk.section ? ` | ${chunk.section}` : ''
              }]\n${chunk.content}`,
          )
          .join('\n\n')
      : 'Nenhum trecho oficial correspondente a esta mensagem.';

  const topic = topicLabel(chunks, activePrior?.topic);
  const history =
    followUp || casual
      ? listAiContext({ guildId, userId, channelId, limit: 8 })
      : [];
  const followUpHint = followUp
    ? `\nAssunto em discussão: ${topic}. Esta mensagem continua o mesmo tema (${truncate(activePrior?.query || topic, 120)}). Responda o que foi perguntado agora com os TRECHOS OFICIAIS. Se pedirem o contrário (maior/menor, com/sem, outro item), use o trecho correspondente — não repita só a resposta anterior.\nSe perguntarem por que seguir, use definição, ressalva e consequência prática que estiverem nos trechos.`
    : `\nEsta é uma pergunta NOVA. Ignore o histórico e qualquer assunto anterior. Responda só com os TRECHOS OFICIAIS abaixo. Não fale de parcerias, mapas, Iraque, Galaxy, Alaska ou Seita se a pergunta não for sobre isso.`;
  const release = acquireAiSlot(userId);
  let rawAnswer;
  try {
    rawAnswer = await llm.complete([
      {
        role: 'system',
        content: conversational ? SYSTEM_PROMPT_CHAT : SYSTEM_PROMPT,
      },
      ...history,
      {
        role: 'user',
        content: conversational
          ? casual
            ? `Mensagem do membro:\n${truncate(question, 500)}\n\nResponda só como conversa curta, no tom do Coroa. Não cite regras, arquivos nem fontes.`
            : `Mensagem do membro:\n${truncate(question, 500)}\n${followUpHint}\nTRECHOS OFICIAIS:\n${truncate(context, 6000)}\n\nSe os trechos definirem o termo, responda com definição e exceções. Não diga que falta informação. Não cite arquivo, pasta nem fontes.`
          : `Pergunta do membro:\n${truncate(question, 500)}\n\nResponda com o que estiver nos trechos abaixo. Se algum trecho definir o termo perguntado, essa é a resposta — definição e exceções juntas. Não diga que está incompleto. Não cite arquivo, pasta nem fontes.\n\nTRECHOS OFICIAIS:\n${truncate(context, 6000)}`,
      },
    ]);
  } finally {
    release();
  }

  const validated = validateGeneratedAnswer(rawAnswer, { chunks, casual });
  const answer = validated.ok
    ? validated.answer
    : notFoundAnswer(question, conversational);
  const sources = uniqueSources(chunks);
  await remember(guildId, userId, channelId, 'user', question);
  await remember(guildId, userId, channelId, 'assistant', answer);
  if (chunks.length > 0 && validated.ok) {
    await saveLastRule(channelId, userId, guildId, {
      query: followUp ? activePrior.query || question : question,
      topic,
      chunks,
      theme: themeNow || (followUp ? activePrior?.theme : null),
      ids: followUp ? activePrior?.ids || [] : [],
    });
  }
  const outcome = validated.ok ? (casual ? 'chat' : 'rag') : 'invalid';
  logOutcome({
    guildId,
    userId,
    question,
    answer,
    sources,
    theme: themeNow,
    path: casual ? 'chat' : 'rag',
    latencyMs: latency(),
    outcome,
  });

  return {
    answer,
    sources,
    found: chunks.length > 0 && validated.ok,
    useEmbed: false,
    embedTitle: chunks.length > 0 ? embedTitleFromChunks(chunks) : 'Regras da facção',
    attachments: [],
    cards: [],
    path: casual ? 'chat' : 'rag',
    outcome,
  };
}

module.exports = {
  answerQuestion,
  validateGeneratedAnswer,
  notFoundAnswer,
};
