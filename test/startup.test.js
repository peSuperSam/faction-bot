const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.chdir(require('node:path').resolve(__dirname, '..'));

const { validateStartupEnv } = require('../src/startup');
const { assertQuestionSize, MAX_QUESTION_CHARS } = require('../src/ai-limit');

describe('startup e limites', () => {
  it('detecta env obrigatório ausente', () => {
    const previous = {
      DISCORD_TOKEN: process.env.DISCORD_TOKEN,
      DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
      DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
    };
    process.env.DISCORD_TOKEN = '';
    const result = validateStartupEnv();
    assert.equal(result.ok, false);
    assert.ok(result.missing.includes('DISCORD_TOKEN'));
    process.env.DISCORD_TOKEN = previous.DISCORD_TOKEN;
    process.env.DISCORD_CLIENT_ID = previous.DISCORD_CLIENT_ID;
    process.env.DISCORD_GUILD_ID = previous.DISCORD_GUILD_ID;
  });

  it('rejeita pergunta longa demais', () => {
    assert.throws(
      () => assertQuestionSize('x'.repeat(MAX_QUESTION_CHARS + 1)),
      (error) => error.code === 'AI_TOO_LONG',
    );
  });
});
