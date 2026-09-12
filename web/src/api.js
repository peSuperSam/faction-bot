let cachedMe = null;
let cachedAt = 0;

const PAGE_TTL_MS = 25_000;
const ME_SESSION_TTL_MS = 5 * 60_000;
const pageCache = new Map();
const inflight = new Map();

export const NAV_PREFETCH = {
  '/painel': ['/v1/dashboard'],
  '/painel/farm': ['/v1/farm'],
  '/painel/membros': ['/v1/members'],
  '/painel/auditoria': ['/v1/audit'],
  '/painel/documentos': ['/v1/documents', '/v1/releases'],
  '/painel/ia': ['/v1/ai'],
  '/painel/servidor': ['/v1/guild'],
  '/painel/config': ['/v1/dashboard'],
  '/painel/status': ['/v1/status'],
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {
        error: /NOT_FOUND/i.test(text)
          ? 'Rota da API não encontrada.'
          : 'Falha na requisição.',
      };
    }
  }
  if (!response.ok) {
    const error = new Error(data.error || 'Falha na requisição.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export function peekMe() {
  return cachedMe;
}

export async function fetchMe({ force = false, maxAge = 15_000 } = {}) {
  if (!force && cachedMe && Date.now() - cachedAt < maxAge) {
    return cachedMe;
  }
  try {
    cachedMe = await request('/api/auth/me');
    cachedAt = Date.now();
    return cachedMe;
  } catch (error) {
    if (error.status === 409) {
      cachedMe = {
        user: { id: '', tag: '', role: null, isDeveloper: false },
        guild: null,
        needsGuild: true,
      };
      cachedAt = Date.now();
      return cachedMe;
    }
    cachedMe = null;
    cachedAt = 0;
    return null;
  }
}

export function clearMe() {
  cachedMe = null;
  cachedAt = 0;
  pageCache.clear();
  inflight.clear();
}

export function peekPage(path) {
  return pageCache.get(path)?.data ?? null;
}

export function invalidatePages(...prefixes) {
  if (!prefixes.length) {
    pageCache.clear();
    return;
  }
  for (const key of [...pageCache.keys()]) {
    if (prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}?`))) {
      pageCache.delete(key);
    }
  }
}

export function prefetch(path, { force = false } = {}) {
  const hit = pageCache.get(path);
  if (!force && hit?.data && Date.now() - hit.at < PAGE_TTL_MS) {
    return Promise.resolve(hit.data);
  }
  if (!force && inflight.has(path)) {
    return inflight.get(path);
  }
  const pending = api(path)
    .then((data) => {
      pageCache.set(path, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      if (inflight.get(path) === pending) {
        inflight.delete(path);
      }
    });
  inflight.set(path, pending);
  return pending;
}

export function prefetchNav(to) {
  const paths = NAV_PREFETCH[to];
  if (!paths) {
    return;
  }
  paths.forEach((path) => prefetch(path));
}

export function api(path, options = {}) {
  const body = options.body == null ? undefined : JSON.stringify(options.body);
  const url = new URL(path, 'http://local');
  const search = new URLSearchParams(url.search);
  search.set('path', url.pathname);
  return request(`/api/proxy?${search}`, {
    method: options.method || 'GET',
    body,
  });
}

export function listGuilds() {
  return api('/v1/guilds');
}

export async function selectGuild(guildId) {
  const data = await api('/v1/guilds/select', {
    method: 'POST',
    body: { guildId },
  });
  clearMe();
  return data;
}

export { ME_SESSION_TTL_MS };
