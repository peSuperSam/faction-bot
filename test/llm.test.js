const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.chdir(require('node:path').resolve(__dirname, '..'));

const llm = require('../src/ai-llm');
const { publicErrorMessage } = require('../src/discord-util');

describe('LLM e erros', () => {
  after(() => {
    llm.resetCircuitBreaker();
    llm.setCompleteImpl(null);
  });

  it('abre o circuit breaker depois de falhas seguidas', async () => {
    llm.resetCircuitBreaker();
    const previous = process.env.AI_BREAKER_THRESHOLD;
    process.env.AI_BREAKER_THRESHOLD = '2';
    llm.setCompleteImpl(async () => {
      throw Object.assign(new Error('down'), { status: 502 });
    });
    await assert.rejects(() => llm.complete([]));
    await assert.rejects(() => llm.complete([]));
    await assert.rejects(
      () => llm.complete([]),
      (error) => error.code === 'AI_UNAVAILABLE',
    );
    llm.resetCircuitBreaker();
    llm.setCompleteImpl(null);
    process.env.AI_BREAKER_THRESHOLD = previous;
  });

  it('mapeia cota e chave', () => {
    assert.match(llm.userFacingAiError({ status: 402 }), /cota/i);
    assert.match(llm.userFacingAiError({ status: 401 }), /chave/i);
    assert.match(llm.userFacingAiError({ status: 429 }), /limite/i);
    assert.match(llm.userFacingAiError({ status: 404 }), /modelo/i);
  });
});
