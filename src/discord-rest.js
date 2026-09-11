const API = 'https://discord.com/api/v10';

function botToken() {
  return String(process.env.DISCORD_TOKEN || '').trim();
}

async function discordRequest(method, path, { body, token, query } = {}) {
  const auth = token || botToken();
  if (!auth) {
    const error = new Error('DISCORD_TOKEN ausente.');
    error.status = 500;
    throw error;
  }
  const url = new URL(`${API}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const headers = {
    Authorization: token && !token.startsWith('Bot ') && !token.startsWith('Bearer ')
      ? `Bearer ${token}`
      : token?.startsWith('Bot ') || token?.startsWith('Bearer ')
        ? token
        : `Bot ${auth}`,
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!response.ok) {
    const error = new Error(
      data?.message || `Discord ${response.status} em ${method} ${path}`,
    );
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

function toRestPayload(message) {
  const serialize = (item) =>
    item && typeof item.toJSON === 'function' ? item.toJSON() : item;
  return {
    allowed_mentions: message.allowedMentions || { parse: [] },
    content: message.content || undefined,
    embeds: (message.embeds || []).map(serialize),
    components: (message.components || []).map(serialize),
  };
}

async function fetchMember(guildId, userId) {
  return discordRequest('GET', `/guilds/${guildId}/members/${userId}`);
}

async function fetchGuild(guildId) {
  return discordRequest('GET', `/guilds/${guildId}`);
}

async function fetchRoles(guildId) {
  return discordRequest('GET', `/guilds/${guildId}/roles`);
}

async function listMembers(guildId, { limit = 1000 } = {}) {
  const members = [];
  let after;
  while (members.length < 5000) {
    const batch = await discordRequest('GET', `/guilds/${guildId}/members`, {
      query: { limit: Math.min(limit, 1000), after },
    });
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    members.push(...batch);
    if (batch.length < 1000) {
      break;
    }
    after = batch[batch.length - 1]?.user?.id;
    if (!after) {
      break;
    }
  }
  return members;
}

async function fetchBotUser() {
  return discordRequest('GET', '/users/@me');
}

async function sendMessage(channelId, payload) {
  return discordRequest('POST', `/channels/${channelId}/messages`, {
    body: payload,
  });
}

async function editMessage(channelId, messageId, payload) {
  return discordRequest('PATCH', `/channels/${channelId}/messages/${messageId}`, {
    body: payload,
  });
}

module.exports = {
  discordRequest,
  toRestPayload,
  fetchMember,
  fetchGuild,
  fetchRoles,
  listMembers,
  fetchBotUser,
  sendMessage,
  editMessage,
};
