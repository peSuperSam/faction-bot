const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveOraclePath, oracleQueryString } = require('../api/_lib/http');

describe('proxy Vercel → Oracle', () => {
  it('lê o caminho em query ou em /api/proxy/v1/...', () => {
    assert.equal(
      resolveOraclePath({ url: '/api/proxy?path=/v1/guilds' }),
      '/v1/guilds',
    );
    assert.equal(
      resolveOraclePath({ url: '/api/proxy/v1/guilds/select' }),
      '/v1/guilds/select',
    );
    assert.equal(
      resolveOraclePath({ url: '/api/proxy?path=v1/dashboard' }),
      '/v1/dashboard',
    );
  });

  it('não encaminha o parâmetro path ao Oracle', () => {
    assert.equal(oracleQueryString({ url: '/api/proxy?path=/v1/farm' }), '');
    assert.equal(
      oracleQueryString({ url: '/api/proxy?path=/v1/farm&status=pending' }),
      '?status=pending',
    );
  });

  it('recusa caminho fora de /v1/', () => {
    assert.throws(
      () => resolveOraclePath({ url: '/api/proxy?path=/secret' }),
      (error) => error.status === 400,
    );
    assert.throws(
      () => resolveOraclePath({ url: '/api/proxy?path=/v1/../etc' }),
      (error) => error.status === 400,
    );
  });
});
