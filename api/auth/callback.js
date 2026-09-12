const {
  OAUTH_COOKIE,
  COOKIE_NAME,
  readCookie,
  signSession,
  sessionCookie,
  clearCookie,
} = require('../../src/web-session');
const { publicBase, cookiesSecure, sendJson } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Método não suportado.' });
    return;
  }
  const url = new URL(req.url, publicBase(req));
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const raw = readCookie(req.headers.cookie, OAUTH_COOKIE);
  let stored = null;
  try {
    stored = raw ? JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) : null;
  } catch {
    stored = null;
  }
  if (!code || !state || !stored?.state || stored.state !== state) {
    sendJson(res, 400, { error: 'Login Discord inválido ou expirado.' });
    return;
  }
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${publicBase(req)}/api/auth/callback`,
    code_verifier: stored.verifier,
  });
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const token = await tokenRes.json();
  if (!tokenRes.ok || !token.access_token) {
    sendJson(res, 401, { error: 'Não foi possível concluir o login no Discord.' });
    return;
  }
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const user = await userRes.json();
  if (!userRes.ok || !user.id) {
    sendJson(res, 401, { error: 'Não foi possível ler o usuário Discord.' });
    return;
  }
  const session = signSession({
    sub: user.id,
    tag: user.global_name || user.username,
    avatar: user.avatar || null,
  });
  const secure = cookiesSecure();
  res.setHeader('Set-Cookie', [
    sessionCookie(session, { secure }),
    clearCookie(OAUTH_COOKIE, { secure }),
  ]);
  res.writeHead(302, { Location: '/servidores' });
  res.end();
};
