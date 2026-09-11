const COOLDOWN_MS = Number(process.env.AI_COOLDOWN_MS || 4000);
const GLOBAL_MAX = Number(process.env.AI_MAX_CONCURRENT || 3);
const MAX_QUESTION_CHARS = Number(process.env.AI_MAX_QUESTION_CHARS || 500);
const WINDOW_MS = Number(process.env.AI_WINDOW_MS || 60000);
const WINDOW_MAX = Number(process.env.AI_WINDOW_MAX || 12);
const userLast = new Map();
const userBusy = new Set();
const userWindow = new Map();
let globalActive = 0;

function assertQuestionSize(question) {
  const text = String(question || '');
  if (text.length > MAX_QUESTION_CHARS) {
    const error = new Error(
      `Essa pergunta está longa demais. Resume em até ${MAX_QUESTION_CHARS} caracteres.`,
    );
    error.code = 'AI_TOO_LONG';
    throw error;
  }
}

function noteAiRequest(userId) {
  if (!userId) {
    return;
  }
  const now = Date.now();
  const stamps = (userWindow.get(userId) || []).filter(
    (stamp) => now - stamp < WINDOW_MS,
  );
  if (stamps.length >= WINDOW_MAX) {
    const error = new Error(
      'Você mandou perguntas demais neste minuto. Espera um pouco e tenta de novo.',
    );
    error.code = 'AI_COOLDOWN';
    throw error;
  }
  stamps.push(now);
  userWindow.set(userId, stamps);
}

function acquireAiSlot(userId) {
  const now = Date.now();
  const last = userLast.get(userId) || 0;
  if (now - last < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
    const error = new Error(
      `Espere ${wait}s antes de mandar outra mensagem para a IA.`,
    );
    error.code = 'AI_COOLDOWN';
    throw error;
  }
  if (userBusy.has(userId)) {
    const error = new Error('Ainda estou respondendo sua mensagem anterior.');
    error.code = 'AI_BUSY';
    throw error;
  }
  if (globalActive >= GLOBAL_MAX) {
    const error = new Error('A IA está ocupada. Tente de novo em instantes.');
    error.code = 'AI_BUSY';
    throw error;
  }
  userBusy.add(userId);
  globalActive += 1;
  userLast.set(userId, now);
  return () => {
    userBusy.delete(userId);
    globalActive = Math.max(0, globalActive - 1);
  };
}

function resetAiLimitForTests() {
  userLast.clear();
  userBusy.clear();
  userWindow.clear();
  globalActive = 0;
}

module.exports = {
  acquireAiSlot,
  assertQuestionSize,
  noteAiRequest,
  resetAiLimitForTests,
  MAX_QUESTION_CHARS,
};
