const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { signSession, verifySession } = require('../src/web-session');

describe('sessão JWT', () => {
  const secret = 'test-session-secret-value';

  it('assina e verifica payload', () => {
    const token = signSession({ sub: 'u1', tag: 'lead', avatar: 'abc' }, { secret, ttlMs: 60_000 });
    const payload = verifySession(token, { secret });
    assert.equal(payload.sub, 'u1');
    assert.equal(payload.tag, 'lead');
    assert.equal(payload.avatar, 'abc');
  });

  it('rejeita assinatura errada e token expirado', () => {
    const token = signSession({ sub: 'u1' }, { secret, ttlMs: 1 });
    assert.equal(verifySession(token, { secret: 'other' }), null);
    const expired = signSession({ sub: 'u1' }, { secret, ttlMs: -10 });
    assert.equal(verifySession(expired, { secret }), null);
  });
});
