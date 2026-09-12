const http = require('node:http');
const { URL } = require('node:url');
const { getSettings, upsertUser, upsertGuildMember, upsertGuild } = require('./db');
const { verifySession } = require('./web-session');
const {
  resolveAccess,
  assertRole,
  isDeveloper,
  listPanelGuilds,
  assertCanOpenGuild,
  discordAvatarUrl,
  guildIconUrl,
} = require('./web-authz');
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
      if (size > 320_000) {
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

function isGuildPickerRoute(method, pathname) {
  return (
    (method === 'GET' && pathname === '/v1/guilds') ||
    (method === 'POST' && pathname === '/v1/guilds/select')
  );
}

async function authenticate(req, url, discord) {
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
  const guildId =
    session?.guildId ||
    readHeader(req, 'x-coroa-guild-id') ||
    '';
  const base = {
    guildId: guildId || null,
    userId: String(userId),
    tag: session?.tag || userId,
    access: resolveAccess({ userId }),
    session,
  };

  if (isGuildPickerRoute(req.method, url.pathname)) {
    return base;
  }
  if (req.method === 'GET' && url.pathname === '/v1/me' && !guildId) {
    return base;
  }
  if (!guildId) {
    throw new HttpError(409, 'Selecione um servidor.');
  }

  let member = null;
  let roles = [];
  let guild = { id: guildId };
  try {
    member = await discord.fetchMember(guildId, userId);
  } catch {
    if (!isDeveloper(userId)) {
      throw new HttpError(403, 'Você precisa ser administrador deste servidor.');
    }
  }
  try {
    roles = await discord.fetchRoles(guildId);
    guild = await discord.fetchGuild(guildId);
  } catch {
    // desenvolvedor ainda pode abrir o painel
  }
  const access = resolveAccess({
    userId,
    member,
    roles,
    guild,
    settings: getSettings(guildId),
  });
  if (!access.canOpenPanel) {
    if (req.method === 'GET' && url.pathname === '/v1/me') {
      return { ...base, guildId: null };
    }
    throw new HttpError(
      403,
      'Apenas administradores deste servidor podem usar o painel.',
    );
  }
  const tag = session?.tag || member?.user?.global_name || member?.user?.username || userId;
  try {
    upsertUser(userId, tag);
    upsertGuildMember({ guildId, userId, tag, status: 'active' });
    if (guild?.id) {
      upsertGuild({
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        ownerId: guild.owner_id || guild.ownerId,
        memberCount: guild.approximate_member_count || guild.memberCount,
      });
    }
  } catch {
    // auditoria incremental não deve derrubar o painel
  }
  return {
    ...base,
    guildId,
    tag,
    access,
    guild,
    member,
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
    if (!guildId) {
      return {
        user: {
          id: auth.userId,
          tag: auth.tag,
          avatar: discordAvatarUrl(auth.userId, auth.session?.avatar),
          role: auth.access.isDeveloper ? 'developer' : null,
          isDeveloper: auth.access.isDeveloper,
          isLeader: false,
          isManager: false,
        },
        guild: null,
        needsGuild: true,
      };
    }
    return {
      user: {
        id: auth.userId,
        tag: auth.tag,
        avatar: discordAvatarUrl(
          auth.userId,
          auth.session?.avatar || auth.member?.user?.avatar,
          { guildId, memberHash: auth.member?.avatar },
        ),
        role: access.role,
        isDeveloper: access.isDeveloper,
        isLeader: access.isLeader,
        isManager: access.isManager,
        canOpenPanel: access.canOpenPanel,
      },
      guild: {
        id: guildId,
        name: auth.guild?.name || guildId,
        icon: guildIconUrl(auth.guild),
      },
      needsGuild: false,
      settings: services.publicSettings(access.settings),
    };
  }

  if (method === 'GET' && pathname === '/v1/guilds') {
    const guilds = await listPanelGuilds({ userId: auth.userId, discord });
    return { guilds };
  }

  if (method === 'POST' && pathname === '/v1/guilds/select') {
    const body = await parseBody(req);
    const selected = String(body?.guildId || '').trim();
    if (!selected) {
      throw new HttpError(400, 'Servidor inválido.');
    }
    const opened = await assertCanOpenGuild({
      userId: auth.userId,
      guildId: selected,
      discord,
    });
    return { ok: true, guild: opened.guild };
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

  if (method === 'GET' && pathname === '/v1/guild') {
    assertRole(access, 'member');
    return services.getGuildPage(guildId);
  }

  if (method === 'POST' && pathname === '/v1/guild/refresh') {
    assertRole(access, 'leader');
    return services.refreshGuild(guildId, actor, discord);
  }

  if (method === 'PATCH' && pathname === '/v1/guild') {
    assertRole(access, 'leader');
    const body = await parseBody(req);
    return services.updateGuildIdentity(guildId, actor, body || {});
  }

  if (method === 'GET' && pathname === '/v1/documents') {
    assertRole(access, 'manager');
    return services.listGuildDocuments(guildId, {
      status: url.searchParams.get('status') || null,
    });
  }

  if (method === 'POST' && pathname === '/v1/documents') {
    assertRole(access, 'leader');
    const body = await parseBody(req);
    return services.createGuildDocument(guildId, actor, body || {});
  }

  if (method === 'POST' && pathname === '/v1/documents/validate') {
    assertRole(access, 'manager');
    const body = await parseBody(req);
    return services.validateGuildDocuments(guildId, body?.documentIds);
  }

  if (method === 'POST' && pathname === '/v1/documents/publish') {
    assertRole(access, 'leader');
    const body = await parseBody(req);
    return services.publishGuildDocuments(guildId, actor, body || {});
  }

  const restoreMatch = pathname.match(/^\/v1\/documents\/(\d+)\/restore$/);
  if (method === 'POST' && restoreMatch) {
    assertRole(access, 'leader');
    const body = await parseBody(req);
    return services.restoreDocumentVersion(
      guildId,
      actor,
      Number(restoreMatch[1]),
      body?.versionNumber,
    );
  }

  const versionsMatch = pathname.match(/^\/v1\/documents\/(\d+)\/versions$/);
  if (method === 'GET' && versionsMatch) {
    assertRole(access, 'manager');
    return services.listDocumentVersions(guildId, Number(versionsMatch[1]));
  }

  const documentMatch = pathname.match(/^\/v1\/documents\/(\d+)$/);
  if (documentMatch && method === 'GET') {
    assertRole(access, 'manager');
    return services.getGuildDocument(guildId, Number(documentMatch[1]));
  }
  if (documentMatch && method === 'PATCH') {
    assertRole(access, 'leader');
    const body = await parseBody(req);
    return services.updateGuildDocument(guildId, actor, Number(documentMatch[1]), body || {});
  }

  if (method === 'GET' && pathname === '/v1/releases') {
    assertRole(access, 'manager');
    return services.listGuildReleases(guildId);
  }

  const rollbackMatch = pathname.match(/^\/v1\/releases\/(\d+)\/rollback$/);
  if (method === 'POST' && rollbackMatch) {
    assertRole(access, 'leader');
    return services.rollbackGuildRelease(guildId, actor, Number(rollbackMatch[1]));
  }

  if (method === 'GET' && pathname === '/v1/catalogs') {
    assertRole(access, 'manager');
    return services.getGuildCatalogs(guildId);
  }

  if (method === 'POST' && pathname === '/v1/catalogs/import') {
    assertRole(access, 'leader');
    const body = await parseBody(req);
    return services.importGuildCatalog(guildId, actor, body?.kind, body?.items);
  }

  if (method === 'GET' && pathname === '/v1/ai/entitlements') {
    assertRole(access, 'leader');
    return services.getAiEntitlements(guildId);
  }

  if (method === 'GET' && pathname === '/v1/ai/usage') {
    assertRole(access, 'leader');
    return services.getAiUsage(guildId);
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
      const auth = await authenticate(req, url, discord);
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
