const { sessionFromRequest, sendJson, proxyToOracle } = require('../_lib/http');

module.exports = async function handler(req, res) {
  const session = sessionFromRequest(req);
  if (!session?.payload) {
    sendJson(res, 401, { error: 'Faça login.' });
    return;
  }
  await proxyToOracle(req, res, { path: '/v1/me', session });
};
