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
      data = { error: text };
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
  } catch {
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
  return request(`/api/proxy${path}`, {
    method: options.method || 'GET',
    body,
  });
}
