const {
  sessionFromRequest,
  sendJson,
  proxyToOracle,
  resolveOraclePath,
} = require('./_lib/http');

module.exports = async function handler(req, res) {
  const session = sessionFromRequest(req);
  if (!session?.payload) {
    sendJson(res, 401, { error: 'Faça login.' });
    return;
  }
  let path;
  try {
    path = resolveOraclePath(req);
  } catch (error) {
    sendJson(res, error.status || 400, { error: error.message });
    return;
  }
  if (!path) {
    sendJson(res, 400, { error: 'Rota inválida.' });
    return;
  }
  await proxyToOracle(req, res, { path, session });
};
