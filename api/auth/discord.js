const {
  randomToken,
  pkceVerifier,
  pkceChallenge,
  OAUTH_COOKIE,
} = require('../../src/web-session');
const { publicBase, cookiesSecure, sendJson } = require('../_lib/http');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Método não suportado.' });
    return;
  }
  const clientId = String(process.env.DISCORD_CLIENT_ID || '').trim();
  if (!clientId) {
    sendJson(res, 500, { error: 'DISCORD_CLIENT_ID ausente.' });
    return;
  }
  const verifier = pkceVerifier();
  const state = randomToken(16);
  const payload = Buffer.from(JSON.stringify({ state, verifier })).toString('base64url');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${publicBase(req)}/api/auth/callback`,
    response_type: 'code',
    scope: 'identify',
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  const cookie = [
    `${OAUTH_COOKIE}=${payload}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600',
  ];
  if (cookiesSecure()) {
    cookie.push('Secure');
  }
  res.writeHead(302, {
    Location: `https://discord.com/api/oauth2/authorize?${params}`,
    'Set-Cookie': cookie.join('; '),
  });
  res.end();
};
