const { sessionFromRequest, sendJson, proxyToOracle } = require('../_lib/http');

module.exports = async function handler(req, res) {
  const session = sessionFromRequest(req);
  if (!session?.payload) {
    sendJson(res, 401, { error: 'Faça login.' });
    return;
  }
  const prefix = '/api/proxy';
  const urlPath = req.url.split('?')[0];
  const path = urlPath.startsWith(prefix) ? urlPath.slice(prefix.length) : urlPath;
  await proxyToOracle(req, res, { path: path || '/v1/dashboard', session });
};
