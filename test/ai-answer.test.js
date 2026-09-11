const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.chdir(require('node:path').resolve(__dirname, '..'));

const llm = require('../src/ai-llm');
const { resetAiLimitForTests } = require('../src/ai-limit');
const { reloadKnowledge } = require('../src/knowledge');
const {
  answerQuestion,
  validateGeneratedAnswer,
} = require('../src/ai-answer');

describe('resposta da IA', () => {
  before(() => {
    reloadKnowledge();
    resetAiLimitForTests();
  });

  after(() => {
    llm.setCompleteImpl(null);
    resetAiLimitForTests();
  });

  it('usa ficha de catálogo sem chamar o LLM', async () => {
    let called = 0;
    llm.setCompleteImpl(async () => {
      called += 1;
      return 'não deveria';
    });
    const result = await answerQuestion({
      question: 'Quanto é lockpick com parceria?',
      userId: 'test-user',
      guildId: 'test-guild',
      channelId: 'test-channel',
    });
    assert.equal(called, 0);
    assert.equal(result.outcome, 'ficha');
    assert.match(result.answer, /Lockpick/);
  });

  it('recusa pergunta sem fonte em vez de inventar', async () => {
    llm.setCompleteImpl(async () => 'O preço secreto é $999999');
    const result = await answerQuestion({
      question: 'Qual a regra de xyzzy-inexistente-123?',
      userId: 'test-user-2',
      guildId: 'test-guild',
      channelId: 'test-channel-2',
    });
    assert.equal(result.found, false);
    assert.ok(['miss', 'invalid'].includes(result.outcome));
    assert.doesNotMatch(result.answer, /999999/);
  });

  it('valida resposta vazia e preço sem trecho', () => {
    assert.equal(validateGeneratedAnswer('', { chunks: [{ content: 'x' }] }).ok, false);
    assert.equal(
      validateGeneratedAnswer('custa $10', { chunks: [{ content: 'RDM é morte' }], casual: false }).ok,
      false,
    );
    assert.equal(
      validateGeneratedAnswer('RDM é matar sem motivo.', {
        chunks: [{ content: 'RDM' }],
      }).ok,
      true,
    );
  });

  it('usa LLM mockado só no caminho de regra', async () => {
    llm.setCompleteImpl(async () => 'RDM é matar outro player sem motivo RP.');
    const result = await answerQuestion({
      question: 'Qual a regra de RDM?',
      userId: 'test-user-3',
      guildId: 'test-guild',
      channelId: 'test-channel-3',
    });
    assert.equal(result.outcome, 'rag');
    assert.match(result.answer, /RDM/);
  });
});
