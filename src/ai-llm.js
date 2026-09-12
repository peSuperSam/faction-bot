function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash-0731';
const BREAKER_THRESHOLD = Number(process.env.AI_BREAKER_THRESHOLD || 5);
const BREAKER_MS = Number(process.env.AI_BREAKER_MS || 30000);

let consecutiveFailures = 0;
let openUntil = 0;

function circuitState() {
  return {
    open: Date.now() < openUntil,
    remainingMs: Math.max(0, openUntil - Date.now()),
    consecutiveFailures,
  };
}

function resetCircuitBreaker() {
  consecutiveFailures = 0;
  openUntil = 0;
}

function assertCircuitClosed() {
  if (Date.now() < openUntil) {
    const wait = Math.ceil((openUntil - Date.now()) / 1000);
    const error = new Error(
      `A IA está temporariamente indisponível. Tenta de novo em ${wait}s.`,
    );
    error.code = 'AI_UNAVAILABLE';
    throw error;
  }
}

function recordSuccess() {
  consecutiveFailures = 0;
  openUntil = 0;
}

function recordFailure() {
  consecutiveFailures += 1;
  const threshold = Number(process.env.AI_BREAKER_THRESHOLD || 5);
  const cooldown = Number(process.env.AI_BREAKER_MS || 30000);
  if (consecutiveFailures >= threshold) {
    openUntil = Date.now() + cooldown;
    console.warn(
      `Circuit breaker da IA aberto por ${Math.round(cooldown / 1000)}s após ${consecutiveFailures} falhas.`,
    );
  }
}

function listApiKeys() {
  const seen = new Set();
  const keys = [];
  const extra = String(process.env.AI_API_KEYS || '').split(/[,;\s]+/);
  for (const value of [process.env.AI_API_KEY, ...extra]) {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function listModels() {
  const primary = String(process.env.AI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const fallback = String(process.env.AI_FALLBACK_MODEL || '').trim();
  return fallback && fallback !== primary ? [primary, fallback] : [primary];
}

function extractAnswer(payload) {
  const message = payload.choices?.[0]?.message || {};
  const raw = message.content;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  if (Array.isArray(raw)) {
    const text = raw
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('')
      .trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function isRetryable(error) {
  return (
    error?.code === 'AI_TIMEOUT' ||
    error?.status === 429 ||
    error?.status >= 500
  );
}

function isKeyProblem(error) {
  return error?.status === 401 || error?.status === 402 || error?.status === 403;
}

function userFacingAiError(error) {
  if (
    error?.code === 'AI_COOLDOWN' ||
    error?.code === 'AI_BUSY' ||
    error?.code === 'AI_TIMEOUT' ||
    error?.code === 'AI_UNAVAILABLE' ||
    error?.code === 'AI_TOO_LONG' ||
    error?.code === 'AI_QUOTA'
  ) {
    return error.message;
  }
  if (error?.status === 402) {
    return 'A cota da IA acabou. A liderança precisa recarregar créditos na OpenRouter.';
  }
  if (error?.status === 401 || error?.status === 403) {
    return 'A chave da IA está inválida ou sem permissão. A liderança precisa atualizar a AI_API_KEY.';
  }
  if (error?.status === 429) {
    return 'A IA está com limite temporário. Tenta de novo em instantes.';
  }
  if (error?.status === 404) {
    return 'O modelo da IA não está disponível agora. Tenta de novo em instantes.';
  }
  if (String(error?.message || '').includes('AI_API_KEY')) {
    return 'A chave da IA não está configurada.';
  }
  return 'A IA não conseguiu responder agora. Tenta de novo em instantes.';
}

async function callOpenRouter(messages, model, apiKey) {
  let response;
  try {
    response = await fetch(
      `${process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1'}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost',
          'X-Title': process.env.OPENROUTER_APP_NAME || 'Faction Farm Bot',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 900,
          reasoning: { effort: 'low' },
          messages,
        }),
        signal: AbortSignal.timeout(25000),
      },
    );
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      const timeout = new Error(
        'A IA demorou demais para responder. Tente de novo.',
      );
      timeout.code = 'AI_TIMEOUT';
      throw timeout;
    }
    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  if (response.status === 429) {
    const error = new Error('rate_limit');
    error.retryAfter = Number(response.headers.get('retry-after')) || null;
    error.status = 429;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(
      payload.error?.message || `OpenRouter retornou ${response.status}`,
    );
    error.status = response.status;
    throw error;
  }

  const answer = extractAnswer(payload);
  if (!answer) {
    throw new Error('A OpenRouter retornou uma resposta vazia.');
  }
  const usage = payload.usage || {};
  return {
    text: answer,
    model,
    usage: {
      inputTokens: Number(usage.prompt_tokens || usage.input_tokens || 0),
      outputTokens: Number(usage.completion_tokens || usage.output_tokens || 0),
    },
  };
}

async function defaultComplete(messages) {
  assertCircuitClosed();
  const keys = listApiKeys();
  if (keys.length === 0) {
    throw new Error('AI_API_KEY não configurada.');
  }
  const models = listModels();
  let lastError;
  let retries = 0;

  modelLoop: for (const model of models) {
    for (const apiKey of keys) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await callOpenRouter(messages, model, apiKey);
          return { ...result, retries };
        } catch (error) {
          lastError = error;
          retries += 1;
          if (error.status === 404) {
            console.warn(`Modelo indisponível: ${model}`);
            continue modelLoop;
          }
          if (isKeyProblem(error)) {
            console.warn(`Chave da IA recusada (${error.status}). Tentando outra, se houver.`);
            break;
          }
          if (isRetryable(error) && attempt < 2) {
            const wait = Math.min(Number(error.retryAfter) || 2 ** attempt, 8);
            await sleep(wait * 1000);
            continue;
          }
          if (isRetryable(error)) {
            break;
          }
          recordFailure();
          throw error;
        }
      }
    }
  }

  throw lastError || new Error('Falha ao consultar a IA.');
}

let completeImpl = defaultComplete;

function normalizeCompletion(answer) {
  if (typeof answer === 'string' || answer == null) {
    return { text: String(answer || ''), model: null, usage: {}, retries: 0 };
  }
  return {
    text: answer.text || '',
    model: answer.model || null,
    usage: answer.usage || {},
    retries: Number(answer.retries || 0),
  };
}

async function complete(messages) {
  assertCircuitClosed();
  try {
    const answer = await completeImpl(messages);
    recordSuccess();
    return normalizeCompletion(answer);
  } catch (error) {
    recordFailure();
    throw error;
  }
}

function setCompleteImpl(fn) {
  completeImpl = fn || defaultComplete;
}

module.exports = {
  userFacingAiError,
  complete,
  setCompleteImpl,
  resetCircuitBreaker,
  circuitState,
  assertCircuitClosed,
};
