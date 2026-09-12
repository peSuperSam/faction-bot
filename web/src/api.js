let cachedMe = null;
let cachedAt = 0;

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

export async function fetchMe({ force = false } = {}) {
  if (!force && cachedMe && Date.now() - cachedAt < 15_000) {
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
