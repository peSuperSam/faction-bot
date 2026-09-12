const {
  readCookie,
  COOKIE_NAME,
  verifySession,
  signSession,
  sessionCookie,
} = require('../../src/web-session');

function publicBase(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (configured) {
    return configured;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  const host = req?.headers?.host;
  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  return host ? `${proto}://${host}` : 'http://localhost:3000';
}

function cookiesSecure() {
  return process.env.VERCEL_ENV ? process.env.VERCEL_ENV !== 'development' : true;
}

function sessionFromRequest(req) {
  const token = readCookie(req.headers.cookie, COOKIE_NAME);
  if (!token) {
    return null;
  }
  return { token, payload: verifySession(token) };
}

async function readBody(req) {
  if (req.body == null) {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString('utf8');
  }
  if (typeof req.body === 'string') {
    return req.body;
  }
  return JSON.stringify(req.body);
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

async function proxyToOracle(req, res, { path, session }) {
  const base = String(process.env.WEB_API_BASE_URL || '').replace(/\/$/, '');
  const secret = String(process.env.WEB_API_SECRET || '').trim();
  if (!base || !secret) {
    sendJson(res, 500, { error: 'WEB_API_BASE_URL ou WEB_API_SECRET ausente na Vercel.' });
    return;
  }
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const headers = {
    'X-Coroa-Service': secret,
    'X-Coroa-User-Id': session.payload.sub,
    'X-Coroa-Session': session.token,
    'X-Coroa-Origin': publicBase(req),
  };
  if (session.payload.guildId) {
    headers['X-Coroa-Guild-Id'] = String(session.payload.guildId);
  }
  const method = req.method || 'GET';
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await readBody(req);
    if (body) {
      headers['Content-Type'] = req.headers['content-type'] || 'application/json';
    }
  }
  const upstream = await fetch(`${base}${path}${query}`, { method, headers, body: body || undefined });
  const text = await upstream.text();
  const responseHeaders = {
    'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  const pickerPath = String(path || '').replace(/\/+$/, '');
  if (pickerPath === '/v1/guilds/select' && upstream.ok) {
    try {
      const data = JSON.parse(text);
      if (data?.ok && data?.guild?.id) {
        const token = signSession({
          sub: session.payload.sub,
          tag: session.payload.tag,
          guildId: String(data.guild.id),
        });
        responseHeaders['Set-Cookie'] = sessionCookie(token, { secure: cookiesSecure() });
      }
    } catch {
      // resposta do Oracle segue igual; o cookie só entra se a seleção for válida
    }
  }
  res.writeHead(upstream.status, responseHeaders);
  res.end(text);
}

module.exports = {
  publicBase,
  cookiesSecure,
  sessionFromRequest,
  sendJson,
  proxyToOracle,
};
