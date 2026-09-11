const http = require('node:http');
const { URL } = require('node:url');
const { getSettings } = require('./db');
const { verifySession } = require('./web-session');
const { resolveAccess, assertRole, isDeveloper } = require('./web-authz');
const services = require('./web-services');
const defaultDiscord = require('./discord-rest');

const DEFAULT_PORT = Number(process.env.WEB_PORT || 8787);
const DEFAULT_HOST = process.env.WEB_LISTEN || '127.0.0.1';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function serviceSecret() {
  return String(process.env.WEB_API_SECRET || '').trim();
}

function allowedOrigins() {
  return String(process.env.WEB_ALLOWED_ORIGINS || '')
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function configuredGuildId() {
  return String(process.env.DISCORD_GUILD_ID || '').trim();
}

function readHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value || '';
}

function timingSafeEqualString(left, right) {
  const crypto = require('node:crypto');
  const a = crypto.createHash('sha256').update(String(left || '')).digest();
  const b = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64_000) {
        reject(new HttpError(413, 'Payload grande demais.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve(null);
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

const rateBuckets = new Map();

function noteRate(key, { windowMs = 60_000, max = 60 } = {}) {
  const now = Date.now();
  const bucket = (rateBuckets.get(key) || []).filter((stamp) => now - stamp < windowMs);
  if (bucket.length >= max) {
    throw new HttpError(429, 'Muitas requisições. Espere um pouco.');
  }
  bucket.push(now);
  rateBuckets.set(key, bucket);
}

function resetRateLimitForTests() {
  rateBuckets.clear();
}

async function authenticate(req, discord) {
  const expected = serviceSecret();
  if (!expected) {
    throw new HttpError(500, 'WEB_API_SECRET não configurado.');
  }
  const provided = readHeader(req, 'x-coroa-service');
  if (!provided || !timingSafeEqualString(provided, expected)) {
    throw new HttpError(401, 'Serviço não autorizado.');
  }
  const origins = allowedOrigins();
  const origin = readHeader(req, 'origin') || readHeader(req, 'x-coroa-origin');
  if (origins.length && origin && !origins.includes(origin)) {
    throw new HttpError(403, 'Origem não autorizada.');
  }
  const sessionHeader = readHeader(req, 'x-coroa-session');
  const session = sessionHeader ? verifySession(sessionHeader) : null;
  const userId = session?.sub || readHeader(req, 'x-coroa-user-id');
  if (!userId) {
    throw new HttpError(401, 'Sessão ausente.');
  }
  noteRate(`user:${userId}`);
  const guildId = configuredGuildId();
  if (!guildId) {
    throw new HttpError(500, 'DISCORD_GUILD_ID ausente.');
  }
  let member = null;
  let roles = [];
  let guild = { id: guildId };
  try {
    member = await discord.fetchMember(guildId, userId);
  } catch {
    if (!isDeveloper(userId)) {
      throw new HttpError(403, 'Você precisa estar no servidor da facção.');
    }
  }
  try {
    roles = await discord.fetchRoles(guildId);
    guild = await discord.fetchGuild(guildId);
  } catch {
    // cargos configurados ainda bastam para líder/gerente/membro
  }
  const access = resolveAccess({
    userId,
    member,
    roles,
    guild,
    settings: getSettings(guildId),
  });
  if (access.role === 'none') {
    throw new HttpError(403, 'Sem cargo da facção para acessar o painel.');
  }
  return {
    guildId,
    userId: String(userId),
    tag: session?.tag || member?.user?.global_name || member?.user?.username || userId,
    access,
  };
}

function actorFrom(auth) {
  return { userId: auth.userId, tag: auth.tag };
}

async function dispatch(req, url, auth, discord) {
  const { pathname } = url;
  const method = req.method;
  const actor = actorFrom(auth);
  const { guildId, access } = auth;

  if (method === 'GET' && pathname === '/v1/me') {
    return {
      user: {
        id: auth.userId,
        tag: auth.tag,
        role: access.role,
        isDeveloper: access.isDeveloper,
        isLeader: access.isLeader,
        isManager: access.isManager,
      },
      settings: services.publicSettings(access.settings),
    };
  }

  if (method === 'GET' && pathname === '/v1/dashboard') {
    assertRole(access, 'member');
    return services.getDashboard(guildId);
  }

  if (method === 'GET' && pathname === '/v1/farm') {
    assertRole(access, 'member');
    const status = url.searchParams.get('status') || null;
    return services.getFarmPage(guildId, { status });
  }

  if (method === 'GET' && pathname === '/v1/members') {
    assertRole(access, 'manager');
    return services.getMembersPage(guildId, discord);
  }

  if (method === 'GET' && pathname === '/v1/audit') {
    assertRole(access, 'manager');
    return services.getAuditPage(guildId);
  }

  if (method === 'GET' && pathname === '/v1/ai') {
    assertRole(access, 'leader');
    return services.getAiPage(guildId);
  }

  if (method === 'POST' && pathname === '/v1/ai/diagnose') {
    assertRole(access, 'leader');
    const body = await parseBody(req);
    const question = String(body?.question || '').trim();
    if (!question) {
      throw new HttpError(400, 'Informe a pergunta.');
    }
    return services.diagnoseQuestion(guildId, auth.userId, question);
  }

  if (method === 'GET' && pathname === '/v1/status') {
    assertRole(access, 'member');
    return services.getStatus();
  }

  if (method === 'POST' && pathname === '/v1/farm/goals') {
    assertRole(access, 'manager');
    const body = await parseBody(req);
    return services.saveGoals(guildId, actor, body?.goals || [], discord);
  }

  if (method === 'POST' && pathname === '/v1/farm/materials') {
    assertRole(access, 'leader');
    const body = await parseBody(req);
    return services.addCatalogMaterial(guildId, actor, body?.name, discord);
  }

  const materialMatch = pathname.match(/^\/v1\/farm\/materials\/([^/]+)$/);
  if (method === 'DELETE' && materialMatch) {
    assertRole(access, 'leader');
    return services.removeCatalogMaterial(
      guildId,
      actor,
      decodeURIComponent(materialMatch[1]),
      discord,
    );
  }

  const reviewMatch = pathname.match(/^\/v1\/farm\/entries\/(\d+)\/(approve|reject)$/);
  if (method === 'POST' && reviewMatch) {
    assertRole(access, 'manager');
    const status = reviewMatch[2] === 'approve' ? 'approved' : 'rejected';
    return services.reviewEntry(guildId, actor, Number(reviewMatch[1]), status, discord);
  }

  const entryMatch = pathname.match(/^\/v1\/farm\/entries\/(\d+)$/);
  if (method === 'PATCH' && entryMatch) {
    assertRole(access, 'manager');
    const body = await parseBody(req);
    return services.correctEntry(guildId, actor, Number(entryMatch[1]), body || {}, discord);
  }
  if (method === 'DELETE' && entryMatch) {
    assertRole(access, 'manager');
    const body = await parseBody(req);
    return services.removeEntry(guildId, actor, Number(entryMatch[1]), body?.reason, discord);
  }

  if (method === 'POST' && pathname === '/v1/farm/panel/refresh') {
    assertRole(access, 'manager');
    return services.refreshPanel(guildId, actor, discord);
  }

  if (method === 'POST' && pathname === '/v1/farm/panel/publish') {
    assertRole(access, 'leader');
    const body = await parseBody(req);
    return services.publishPanel(guildId, actor, body?.channelId, discord);
  }

  if (method === 'PATCH' && pathname === '/v1/settings') {
    assertRole(access, 'leader');
    const body = await parseBody(req);
    return services.updateSettings(guildId, actor, body || {});
  }

  if (method === 'POST' && pathname === '/v1/ai/reload') {
    assertRole(access, 'leader');
    return services.reloadRules(guildId, actor);
  }

  if (method === 'POST' && pathname === '/v1/backup') {
    assertRole(access, 'leader');
    return services.runBackup(guildId, actor);
  }

  throw new HttpError(404, 'Rota não encontrada.');
}

function createWebHandler(overrides = {}) {
  const discord = overrides.discord || defaultDiscord;
  return async function handle(req, res) {
    const host = readHeader(req, 'host') || `${DEFAULT_HOST}:${DEFAULT_PORT}`;
    const url = new URL(req.url, `http://${host}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { Allow: 'GET,POST,PATCH,DELETE,OPTIONS' });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true, service: 'coroa-web' });
      return;
    }
    try {
      noteRate(`ip:${readHeader(req, 'x-forwarded-for') || req.socket.remoteAddress || 'local'}`, {
        max: 120,
      });
      const auth = await authenticate(req, discord);
      const payload = await dispatch(req, url, auth, discord);
      sendJson(res, 200, payload);
    } catch (error) {
      const status = Number(error.status || 500);
      if (status >= 500) {
        console.error('Erro na API web:', error);
      }
      sendJson(res, status, {
        error: status >= 500 ? 'Erro interno do painel.' : error.message,
      });
    }
  };
}

function startWebApi(overrides = {}) {
  const host = overrides.host || DEFAULT_HOST;
  const port = overrides.port || DEFAULT_PORT;
  const server = http.createServer(createWebHandler(overrides));
  server.listen(port, host, () => {
    console.log(`API web do Coroa em http://${host}:${port}`);
  });
  return server;
}

module.exports = {
  HttpError,
  createWebHandler,
  startWebApi,
  resetRateLimitForTests,
};
