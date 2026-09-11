const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const contextRoot = path.resolve(
  process.env.AI_CONTEXT_PATH || './data/ai-context',
);
const HISTORY_KEEP = 20;
const TOPIC_TTL_MS = 12 * 60 * 60 * 1000;
const HISTORY_TTL_MS = Number(process.env.AI_CONTEXT_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const writeChains = new Map();

function safeId(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

function userFile(guildId, userId, channelId) {
  const guild = safeId(guildId, 'global');
  const channel = safeId(channelId, 'global');
  const user = safeId(userId, 'anon');
  return path.join(contextRoot, guild, channel, `${user}.json`);
}

function legacyUserFile(guildId, userId) {
  const guild = safeId(guildId, 'global');
  const user = safeId(userId, 'anon');
  return path.join(contextRoot, guild, `${user}.json`);
}

function emptyRecord(guildId, userId, channelId) {
  return {
    guildId: String(guildId || ''),
    channelId: String(channelId || ''),
    userId: String(userId || ''),
    updatedAt: 0,
    messages: [],
    topic: null,
  };
}

function chmodQuiet(target, mode) {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // ignore if not owner
  }
}

function ensureRoot() {
  fs.mkdirSync(contextRoot, { recursive: true });
  chmodQuiet(contextRoot, 0o700);
}

function pruneMessages(messages) {
  const cutoff = Date.now() - HISTORY_TTL_MS;
  return (messages || [])
    .filter((entry) => !entry.at || entry.at >= cutoff)
    .slice(-HISTORY_KEEP);
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function loadRecord(guildId, userId, channelId) {
  const file = userFile(guildId, userId, channelId);
  const parsed = readJsonFile(file) || readJsonFile(legacyUserFile(guildId, userId));
  if (!parsed) {
    return emptyRecord(guildId, userId, channelId);
  }
  return {
    ...emptyRecord(guildId, userId, channelId),
    ...parsed,
    messages: pruneMessages(parsed.messages),
  };
}

function saveRecord(guildId, userId, channelId, record) {
  ensureRoot();
  const file = userFile(guildId, userId, channelId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  chmodQuiet(path.dirname(file), 0o700);
  const payload = JSON.stringify(
    {
      ...record,
      guildId: String(guildId || ''),
      channelId: String(channelId || ''),
      userId: String(userId || ''),
      messages: pruneMessages(record.messages),
      updatedAt: Date.now(),
    },
    null,
    2,
  );
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  chmodQuiet(file, 0o600);
}

function enqueueWrite(file, fn) {
  const previous = writeChains.get(file) || Promise.resolve();
  const next = previous.then(fn, fn);
  writeChains.set(
    file,
    next.catch(() => {}),
  );
  return next;
}

function appendAiContext({ guildId, userId, channelId, role, content }) {
  if (!userId || !content) {
    return Promise.resolve();
  }
  const file = userFile(guildId, userId, channelId);
  return enqueueWrite(file, () => {
    const record = loadRecord(guildId, userId, channelId);
    record.messages = pruneMessages([
      ...(record.messages || []),
      { role, content, at: Date.now() },
    ]);
    saveRecord(guildId, userId, channelId, record);
  });
}

function listAiContext({ guildId, userId, channelId, limit = 8 }) {
  if (!userId) {
    return [];
  }
  return loadRecord(guildId, userId, channelId)
    .messages.slice(-limit)
    .map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));
}

function getAiContextTopic({ guildId, userId, channelId }) {
  if (!userId) {
    return null;
  }
  const record = loadRecord(guildId, userId, channelId);
  const topic = record.topic;
  if (!topic || (!topic.chunks?.length && !topic.theme)) {
    return null;
  }
  const at = Number(topic.at || record.updatedAt || 0);
  if (!at || Date.now() - at > TOPIC_TTL_MS) {
    return null;
  }
  return {
    topic: topic.topic,
    query: topic.query,
    chunks: topic.chunks || [],
    theme: topic.theme || null,
    ids: topic.ids || [],
    at,
  };
}

function setAiContextTopic({
  guildId,
  userId,
  channelId,
  topic,
  query,
  chunks,
  theme,
  ids,
}) {
  if (!userId) {
    return Promise.resolve();
  }
  const file = userFile(guildId, userId, channelId);
  return enqueueWrite(file, () => {
    const record = loadRecord(guildId, userId, channelId);
    record.topic = {
      topic: topic || null,
      query: query || null,
      chunks: chunks || [],
      theme: theme || null,
      ids: ids || [],
      at: Date.now(),
    };
    saveRecord(guildId, userId, channelId, record);
  });
}

function pruneExpiredContext() {
  ensureRoot();
  const cutoff = Date.now() - HISTORY_TTL_MS;
  let removed = 0;
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.json')) {
        continue;
      }
      const parsed = readJsonFile(full);
      const updatedAt = Number(parsed?.updatedAt || 0);
      if (!updatedAt || updatedAt < cutoff) {
        try {
          fs.unlinkSync(full);
          removed += 1;
        } catch {
          // ignore
        }
      }
    }
  };
  walk(contextRoot);
  return removed;
}

function clearAiContext({ guildId, userId, channelId }) {
  const files = [
    userFile(guildId, userId, channelId),
    legacyUserFile(guildId, userId),
  ];
  for (const file of files) {
    try {
      fs.unlinkSync(file);
    } catch {
      // already gone
    }
  }
}

module.exports = {
  contextRoot,
  appendAiContext,
  listAiContext,
  getAiContextTopic,
  setAiContextTopic,
  clearAiContext,
  pruneExpiredContext,
};
