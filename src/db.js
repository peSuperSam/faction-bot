const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { currentWeekInfo } = require('./periods');
const { normalizeMaterial } = require('./util');

const databasePath = path.resolve(
  process.env.DATABASE_PATH || './data/farm.sqlite',
);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function addColumnIfMissing(table, name, definition) {
  if (!tableColumns(table).includes(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS farm_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_tag TEXT NOT NULL,
      material TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (guild_id, name)
    );

    CREATE TABLE IF NOT EXISTS periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'weekly',
      key TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      UNIQUE (guild_id, type, key)
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      material TEXT,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      scope TEXT NOT NULL CHECK (scope IN ('guild', 'user')),
      user_id TEXT,
      period_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (period_id) REFERENCES periods(id)
    );

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      leader_role_id TEXT,
      manager_role_id TEXT,
      member_role_id TEXT,
      log_channel_id TEXT
    );

    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL DEFAULT 1,
      hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      section TEXT,
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT,
      user_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      sources TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_user_topics (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      topic TEXT,
      query TEXT,
      chunks_json TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_farm_entries_guild_material
      ON farm_entries (guild_id, material);
    CREATE INDEX IF NOT EXISTS idx_farm_entries_guild_user
      ON farm_entries (guild_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_materials_guild_active
      ON materials (guild_id, active, name);
    CREATE INDEX IF NOT EXISTS idx_goals_guild_period
      ON goals (guild_id, period_id);
    CREATE INDEX IF NOT EXISTS idx_ai_chat_history_user
      ON ai_chat_history (guild_id, user_id, id);

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS member_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_tag TEXT,
      type TEXT NOT NULL,
      actor_id TEXT,
      role_id TEXT,
      detail TEXT,
      certainty TEXT NOT NULL DEFAULT 'known',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bot_heartbeat (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      started_at TEXT,
      updated_at TEXT NOT NULL,
      details TEXT
    );

    CREATE TABLE IF NOT EXISTS guilds (
      id TEXT PRIMARY KEY,
      name TEXT,
      icon TEXT,
      owner_id TEXT,
      member_count INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      joined_at TEXT,
      left_at TEXT,
      fetched_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tag TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS guild_members (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tag TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS guild_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      current_published_version_id INTEGER,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (guild_id, slug)
    );

    CREATE TABLE IF NOT EXISTS guild_document_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT,
      change_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT,
      FOREIGN KEY (document_id) REFERENCES guild_documents(id) ON DELETE CASCADE,
      UNIQUE (document_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS knowledge_releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      release_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'published',
      created_by TEXT,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT,
      UNIQUE (guild_id, release_number)
    );

    CREATE TABLE IF NOT EXISTS knowledge_release_documents (
      release_id INTEGER NOT NULL,
      document_id INTEGER NOT NULL,
      version_id INTEGER NOT NULL,
      PRIMARY KEY (release_id, document_id),
      FOREIGN KEY (release_id) REFERENCES knowledge_releases(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guild_catalogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (guild_id, kind)
    );

    CREATE TABLE IF NOT EXISTS ai_entitlements (
      guild_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'internal',
      status TEXT NOT NULL DEFAULT 'active',
      monthly_limit INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      starts_at TEXT,
      ends_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL UNIQUE,
      guild_id TEXT NOT NULL,
      user_id TEXT,
      operation TEXT,
      provider TEXT,
      model TEXT,
      status TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      estimated_cost REAL,
      latency_ms INTEGER,
      retries INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_usage_daily (
      guild_id TEXT NOT NULL,
      day TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, day)
    );

    CREATE TABLE IF NOT EXISTS billing_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      email TEXT,
      provider TEXT,
      external_customer_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS billing_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      account_id INTEGER,
      plan TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'incomplete',
      provider TEXT,
      external_subscription_id TEXT UNIQUE,
      period_start TEXT,
      period_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS billing_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      external_event_id TEXT NOT NULL,
      event_type TEXT,
      payload_hash TEXT,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (provider, external_event_id)
    );

    CREATE INDEX IF NOT EXISTS idx_guild_documents_guild
      ON guild_documents (guild_id, status);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_events_guild
      ON ai_usage_events (guild_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_guild
      ON billing_subscriptions (guild_id, status);
  `);

  addColumnIfMissing('farm_entries', 'status', "TEXT NOT NULL DEFAULT 'approved'");
  addColumnIfMissing('farm_entries', 'period_id', 'INTEGER');
  addColumnIfMissing('farm_entries', 'reviewed_by', 'TEXT');
  addColumnIfMissing('farm_entries', 'reviewed_at', 'TEXT');
  addColumnIfMissing('guild_settings', 'ai_channel_id', 'TEXT');
  addColumnIfMissing('guild_settings', 'admin_channel_id', 'TEXT');
  addColumnIfMissing('guild_settings', 'farm_channel_id', 'TEXT');
  addColumnIfMissing('guild_settings', 'farm_panel_message_id', 'TEXT');
  addColumnIfMissing('guild_settings', 'auto_approve', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('ai_logs', 'theme', 'TEXT');
  addColumnIfMissing('ai_logs', 'path', 'TEXT');
  addColumnIfMissing('ai_logs', 'latency_ms', 'INTEGER');
  addColumnIfMissing('ai_logs', 'outcome', "TEXT NOT NULL DEFAULT 'ok'");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_farm_entries_guild_period
      ON farm_entries (guild_id, period_id, status);
    CREATE INDEX IF NOT EXISTS idx_member_events_guild_created
      ON member_events (guild_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_guild_created
      ON audit_events (guild_id, created_at DESC);
  `);

  addColumnIfMissing('guild_settings', 'setup_status', "TEXT NOT NULL DEFAULT 'pending'");
  addColumnIfMissing('guild_settings', 'identity_name', 'TEXT');
  addColumnIfMissing('guild_settings', 'presence_text', 'TEXT');
  addColumnIfMissing('ai_logs', 'request_id', 'TEXT');
  migrateKnowledgeGuildScope();
}

function migrateKnowledgeGuildScope() {
  const cols = tableColumns('knowledge_documents');
  let rebuiltDocs = false;
  if (!cols.includes('guild_id')) {
    db.exec(`
      CREATE TABLE knowledge_documents_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL DEFAULT '__global__',
        scope TEXT NOT NULL DEFAULT 'global',
        source_type TEXT NOT NULL DEFAULT 'file',
        version_id TEXT,
        name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (guild_id, name)
      );
      INSERT INTO knowledge_documents_new
        (id, guild_id, scope, source_type, name, version, hash, status, indexed_at)
      SELECT id, '__global__', 'global', 'file', name, version, hash, status, indexed_at
      FROM knowledge_documents;
      DROP TABLE knowledge_documents;
      ALTER TABLE knowledge_documents_new RENAME TO knowledge_documents;
    `);
    rebuiltDocs = true;
  }
  addColumnIfMissing('knowledge_chunks', 'guild_id', "TEXT NOT NULL DEFAULT '__global__'");
  if (rebuiltDocs || !knowledgeFtsHasGuildColumn()) {
    rebuildKnowledgeFts({ reindex: true });
  }
}

function knowledgeFtsHasGuildColumn() {
  try {
    db.prepare(`SELECT guild_id FROM knowledge_fts LIMIT 1`).get();
    return true;
  } catch {
    return false;
  }
}

function rebuildKnowledgeFts({ reindex = false } = {}) {
  if (knowledgeFtsHasGuildColumn() && !reindex) {
    return;
  }
  db.exec(`DROP TABLE IF EXISTS knowledge_fts`);
  try {
    db.exec(`
      CREATE VIRTUAL TABLE knowledge_fts USING fts5(
        document_name,
        section,
        content,
        guild_id UNINDEXED,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);
  } catch {
    db.exec(`
      CREATE VIRTUAL TABLE knowledge_fts USING fts5(
        document_name,
        section,
        content,
        guild_id UNINDEXED
      );
    `);
  }
  const rows = db
    .prepare(
      `
      SELECT d.name AS document_name, d.guild_id, c.section, c.content
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
    `,
    )
    .all();
  const insert = db.prepare(
    `INSERT INTO knowledge_fts (document_name, section, content, guild_id) VALUES (?, ?, ?, ?)`,
  );
  const tx = db.transaction((items) => {
    for (const row of items) {
      insert.run(row.document_name, row.section, row.content, row.guild_id || '__global__');
    }
  });
  tx(rows);
}

migrate();

function ensureCurrentPeriod(guildId) {
  const week = currentWeekInfo();
  const existing = db
    .prepare(
      `SELECT * FROM periods WHERE guild_id = ? AND type = 'weekly' AND key = ?`,
    )
    .get(guildId, week.key);
  if (existing) {
    backfillPeriodEntries(guildId, existing.id, week);
    return { ...existing, week };
  }

  const result = db
    .prepare(
      `
      INSERT INTO periods (guild_id, type, key, starts_at, ends_at, status)
      VALUES (?, 'weekly', ?, ?, ?, 'open')
    `,
    )
    .run(guildId, week.key, week.startsAt, week.endsAt);
  const period = {
    id: Number(result.lastInsertRowid),
    guild_id: guildId,
    type: 'weekly',
    key: week.key,
    starts_at: week.startsAt,
    ends_at: week.endsAt,
    status: 'open',
    week,
  };
  backfillPeriodEntries(guildId, period.id, week);
  return period;
}

function backfillPeriodEntries(guildId, periodId, week) {
  db.prepare(
    `
    UPDATE farm_entries
    SET period_id = ?
    WHERE guild_id = ?
      AND period_id IS NULL
      AND date(created_at) BETWEEN ? AND ?
  `,
  ).run(periodId, guildId, week.startsAt, week.endsAt);
}

const ROLE_ENV = {
  leader_role_id: 'ROLE_LEADER_ID',
  manager_role_id: 'ROLE_MANAGER_ID',
  member_role_id: 'ROLE_MEMBER_ID',
};

function envRoleId(name) {
  const raw = String(process.env[name] || '').trim();
  if (!/^\d{5,32}$/.test(raw)) {
    return null;
  }
  return raw;
}

function roleIdFromEnv(settingKey) {
  const envName = ROLE_ENV[settingKey];
  return envName ? envRoleId(envName) : null;
}

function getSettings(guildId) {
  const row = db
    .prepare(`SELECT * FROM guild_settings WHERE guild_id = ?`)
    .get(guildId);
  return (
    row || {
      guild_id: guildId,
      leader_role_id: null,
      manager_role_id: null,
      member_role_id: null,
      log_channel_id: null,
      ai_channel_id: null,
      admin_channel_id: null,
      farm_channel_id: null,
      farm_panel_message_id: null,
      auto_approve: 1,
      setup_status: 'pending',
      identity_name: null,
      presence_text: null,
    }
  );
}

function bootstrapEnvRolesIfNeeded(guildId) {
  const envGuild = String(process.env.DISCORD_GUILD_ID || '').trim();
  if (!envGuild || String(guildId) !== envGuild) {
    return getSettings(guildId);
  }
  const row = db
    .prepare(`SELECT * FROM guild_settings WHERE guild_id = ?`)
    .get(guildId);
  if (row?.leader_role_id || row?.manager_role_id || row?.member_role_id) {
    return getSettings(guildId);
  }
  return syncEnvRoleSettings(guildId);
}

function syncEnvRoleSettings(guildId) {
  for (const [settingKey, envName] of Object.entries(ROLE_ENV)) {
    const value = envRoleId(envName);
    if (value) {
      setSetting(guildId, settingKey, value);
    }
  }
  return getSettings(guildId);
}

const SETTING_KEYS = new Set([
  'leader_role_id',
  'manager_role_id',
  'member_role_id',
  'log_channel_id',
  'ai_channel_id',
  'admin_channel_id',
  'farm_channel_id',
  'farm_panel_message_id',
  'auto_approve',
  'setup_status',
  'identity_name',
  'presence_text',
]);

function setSetting(guildId, key, value) {
  if (!SETTING_KEYS.has(key)) {
    throw new Error('Configuração inválida.');
  }
  db.prepare(
    `
    INSERT INTO guild_settings (guild_id, ${key})
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET ${key} = excluded.${key}
  `,
  ).run(guildId, value);
  return getSettings(guildId);
}

function listMaterials(guildId, { activeOnly = true, query = '' } = {}) {
  const normalized = normalizeMaterial(query);
  return db
    .prepare(
      `
      SELECT * FROM materials
      WHERE guild_id = ?
        AND (? = 0 OR active = 1)
        AND (? = '' OR name LIKE '%' || ? || '%' OR display_name LIKE '%' || ? || '%')
      ORDER BY display_name ASC
    `,
    )
    .all(guildId, activeOnly ? 1 : 0, normalized, normalized, query.trim());
}

function getMaterial(guildId, name) {
  return db
    .prepare(
      `SELECT * FROM materials WHERE guild_id = ? AND name = ? AND active = 1`,
    )
    .get(guildId, normalizeMaterial(name));
}

function getMaterialById(guildId, id) {
  return db
    .prepare(
      `SELECT * FROM materials WHERE guild_id = ? AND id = ? AND active = 1`,
    )
    .get(guildId, id);
}

function addMaterial(guildId, rawName) {
  const name = normalizeMaterial(rawName);
  if (!name) {
    throw new Error('Informe um nome de material.');
  }
  const displayName = rawName.trim().replace(/\s+/g, ' ');
  const existing = db
    .prepare(`SELECT * FROM materials WHERE guild_id = ? AND name = ?`)
    .get(guildId, name);
  if (existing?.active) {
    throw new Error('Esse material já está no catálogo.');
  }
  if (existing) {
    db.prepare(
      `UPDATE materials SET active = 1, display_name = ? WHERE id = ?`,
    ).run(displayName, existing.id);
    return { ...existing, active: 1, display_name: displayName };
  }
  const result = db
    .prepare(
      `INSERT INTO materials (guild_id, name, display_name) VALUES (?, ?, ?)`,
    )
    .run(guildId, name, displayName);
  return {
    id: Number(result.lastInsertRowid),
    guild_id: guildId,
    name,
    display_name: displayName,
    active: 1,
  };
}

function deactivateMaterial(guildId, rawName) {
  const material = getMaterial(guildId, rawName);
  if (!material) {
    throw new Error('Material ativo não encontrado no catálogo.');
  }
  db.prepare(`UPDATE materials SET active = 0 WHERE id = ?`).run(material.id);
  return material;
}

function insertAuditEvent({ guildId, actorId, action, targetId = null, detail = null }) {
  db.prepare(
    `
    INSERT INTO audit_events (guild_id, actor_id, action, target_id, detail)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(guildId, actorId, action, targetId, detail);
}

function findRecentDuplicate({
  guildId,
  userId,
  material,
  quantity,
  seconds = 15,
}) {
  return db
    .prepare(
      `
      SELECT * FROM farm_entries
      WHERE guild_id = ?
        AND user_id = ?
        AND material = ?
        AND quantity = ?
        AND created_at >= datetime('now', ?)
      ORDER BY id DESC
      LIMIT 1
    `,
    )
    .get(guildId, userId, material, quantity, `-${Number(seconds)} seconds`);
}

function insertEntry({
  guildId,
  userId,
  userTag,
  material,
  quantity,
  note,
  status,
}) {
  const period = ensureCurrentPeriod(guildId);
  const duplicate = findRecentDuplicate({
    guildId,
    userId,
    material,
    quantity,
  });
  if (duplicate) {
    return {
      id: duplicate.id,
      period,
      status: duplicate.status,
      duplicate: true,
    };
  }
  const settings = getSettings(guildId);
  const resolvedStatus =
    status || (Number(settings.auto_approve) === 0 ? 'pending' : 'approved');
  const result = db
    .prepare(
      `
      INSERT INTO farm_entries
        (guild_id, user_id, user_tag, material, quantity, note, status, period_id)
      VALUES
        (@guildId, @userId, @userTag, @material, @quantity, @note, @status, @periodId)
    `,
    )
    .run({
      guildId,
      userId,
      userTag,
      material,
      quantity,
      note,
      status: resolvedStatus,
      periodId: period.id,
    });
  return {
    id: Number(result.lastInsertRowid),
    period,
    status: resolvedStatus,
    duplicate: false,
  };
}

function getEntry(guildId, id) {
  return db
    .prepare(`SELECT * FROM farm_entries WHERE guild_id = ? AND id = ?`)
    .get(guildId, id);
}

function updateEntry(guildId, id, fields) {
  const entry = getEntry(guildId, id);
  if (!entry) {
    throw new Error('Registro não encontrado.');
  }
  db.prepare(
    `
    UPDATE farm_entries
    SET material = @material,
        quantity = @quantity,
        note = @note,
        reviewed_by = @reviewedBy,
        reviewed_at = datetime('now')
    WHERE id = @id AND guild_id = @guildId
  `,
  ).run({
    id,
    guildId,
    material: fields.material ?? entry.material,
    quantity: fields.quantity ?? entry.quantity,
    note: fields.note === undefined ? entry.note : fields.note,
    reviewedBy: fields.reviewedBy,
  });
  return getEntry(guildId, id);
}

function deleteEntry(guildId, id) {
  const entry = getEntry(guildId, id);
  if (!entry) {
    throw new Error('Registro não encontrado.');
  }
  db.prepare(`DELETE FROM farm_entries WHERE guild_id = ? AND id = ?`).run(
    guildId,
    id,
  );
  return entry;
}

function setEntryStatus(guildId, id, status, reviewedBy) {
  const entry = getEntry(guildId, id);
  if (!entry) {
    throw new Error('Registro não encontrado.');
  }
  if (entry.status === status) {
    return entry;
  }
  db.prepare(
    `
    UPDATE farm_entries
    SET status = ?, reviewed_by = ?, reviewed_at = datetime('now')
    WHERE guild_id = ? AND id = ?
  `,
  ).run(status, reviewedBy, guildId, id);
  return getEntry(guildId, id);
}

function listPending(guildId, periodId) {
  return db
    .prepare(
      `
      SELECT * FROM farm_entries
      WHERE guild_id = ? AND period_id = ? AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 10
    `,
    )
    .all(guildId, periodId);
}

function ownTotals(guildId, userId, periodId, material = null) {
  return db
    .prepare(
      `
      SELECT material, SUM(quantity) AS total, COUNT(*) AS entries
      FROM farm_entries
      WHERE guild_id = ?
        AND user_id = ?
        AND period_id = ?
        AND status = 'approved'
        AND (? IS NULL OR material = ?)
      GROUP BY material
      ORDER BY total DESC, material ASC
    `,
    )
    .all(guildId, userId, periodId, material, material);
}

function ranking(guildId, periodId, material = null, limit = 10) {
  return db
    .prepare(
      `
      SELECT user_id, user_tag, SUM(quantity) AS total
      FROM farm_entries
      WHERE guild_id = ?
        AND period_id = ?
        AND status = 'approved'
        AND (? IS NULL OR material = ?)
      GROUP BY user_id, user_tag
      ORDER BY total DESC, user_tag ASC
      LIMIT ?
    `,
    )
    .all(guildId, periodId, material, material, limit);
}

function totalsByMaterial(guildId, periodId) {
  return db
    .prepare(
      `
      SELECT material, SUM(quantity) AS total, COUNT(*) AS entries
      FROM farm_entries
      WHERE guild_id = ? AND period_id = ? AND status = 'approved'
      GROUP BY material
      ORDER BY total DESC, material ASC
    `,
    )
    .all(guildId, periodId);
}

function userTotals(guildId, periodId) {
  return db
    .prepare(
      `
      SELECT user_id, user_tag, SUM(quantity) AS total
      FROM farm_entries
      WHERE guild_id = ? AND period_id = ? AND status = 'approved'
      GROUP BY user_id, user_tag
      ORDER BY total DESC
    `,
    )
    .all(guildId, periodId);
}

function userMaterialTotal(guildId, periodId, userId, material) {
  const row = db
    .prepare(
      `
      SELECT COALESCE(SUM(quantity), 0) AS total
      FROM farm_entries
      WHERE guild_id = ?
        AND period_id = ?
        AND user_id = ?
        AND material = ?
        AND status = 'approved'
    `,
    )
    .get(guildId, periodId, userId, material);
  return Number(row?.total || 0);
}

function guildMaterialTotal(guildId, periodId, material) {
  const row = db
    .prepare(
      `
      SELECT COALESCE(SUM(quantity), 0) AS total
      FROM farm_entries
      WHERE guild_id = ?
        AND period_id = ?
        AND material = ?
        AND status = 'approved'
    `,
    )
    .get(guildId, periodId, material);
  return Number(row?.total || 0);
}

function upsertGoal({ guildId, material, quantity, scope, userId, periodId }) {
  const existing =
    scope === 'user'
      ? db
          .prepare(
            `
            SELECT * FROM goals
            WHERE guild_id = ? AND period_id = ? AND scope = 'user'
              AND user_id = ? AND material = ?
          `,
          )
          .get(guildId, periodId, userId, material)
      : db
          .prepare(
            `
            SELECT * FROM goals
            WHERE guild_id = ? AND period_id = ? AND scope = 'guild'
              AND user_id IS NULL AND material = ?
          `,
          )
          .get(guildId, periodId, material);

  if (existing) {
    db.prepare(`UPDATE goals SET quantity = ? WHERE id = ?`).run(
      quantity,
      existing.id,
    );
    return getGoalById(existing.id);
  }

  const result = db
    .prepare(
      `
      INSERT INTO goals (guild_id, material, quantity, scope, user_id, period_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    )
    .run(guildId, material, quantity, scope, userId, periodId);
  return getGoalById(Number(result.lastInsertRowid));
}

function getGoalById(id) {
  return db.prepare(`SELECT * FROM goals WHERE id = ?`).get(id);
}

function listGoals(guildId, periodId) {
  return db
    .prepare(
      `
      SELECT * FROM goals
      WHERE guild_id = ? AND period_id = ?
      ORDER BY scope ASC, material ASC
    `,
    )
    .all(guildId, periodId);
}

function replaceKnowledge(documents, { guildId = '__global__', scope = 'global' } = {}) {
  const insertDocument = db.prepare(
    `
    INSERT INTO knowledge_documents
      (guild_id, scope, source_type, version_id, name, version, hash, status, indexed_at)
    VALUES
      (@guildId, @scope, @sourceType, @versionId, @name, @version, @hash, 'active', datetime('now'))
  `,
  );
  const insertChunk = db.prepare(
    `
    INSERT INTO knowledge_chunks (document_id, section, content, chunk_index, guild_id)
    VALUES (?, ?, ?, ?, ?)
  `,
  );
  const insertFts = db.prepare(
    `
    INSERT INTO knowledge_fts (document_name, section, content, guild_id)
    VALUES (?, ?, ?, ?)
  `,
  );

  const tx = db.transaction((docs) => {
    const existing = db
      .prepare(`SELECT id FROM knowledge_documents WHERE guild_id = ?`)
      .all(guildId)
      .map((row) => row.id);
    if (existing.length) {
      db.prepare(
        `DELETE FROM knowledge_chunks WHERE document_id IN (${existing.map(() => '?').join(',')})`,
      ).run(...existing);
    }
    db.prepare(`DELETE FROM knowledge_documents WHERE guild_id = ?`).run(guildId);
    db.prepare(`DELETE FROM knowledge_fts WHERE guild_id = ?`).run(guildId);
    for (const document of docs) {
      const result = insertDocument.run({
        guildId,
        scope,
        sourceType: document.sourceType || (scope === 'global' ? 'file' : 'guild'),
        versionId: document.versionId || null,
        name: document.name,
        version: document.version,
        hash: document.hash,
      });
      const documentId = Number(result.lastInsertRowid);
      document.chunks.forEach((chunk, index) => {
        insertChunk.run(documentId, chunk.section, chunk.content, index, guildId);
        insertFts.run(document.name, chunk.section, chunk.content, guildId);
      });
    }
  });

  tx(documents);
}

function knowledgeGuildFilter(guildId) {
  if (!guildId || guildId === '__global__') {
    return { sql: `guild_id = '__global__'`, params: [] };
  }
  return { sql: `guild_id IN ('__global__', ?)`, params: [String(guildId)] };
}

function searchKnowledge(query, limit = 5, guildId = null) {
  const filter = knowledgeGuildFilter(guildId);
  return db
    .prepare(
      `
      SELECT document_name, section, content, rank, guild_id
      FROM knowledge_fts
      WHERE knowledge_fts MATCH ?
        AND ${filter.sql}
      ORDER BY rank
      LIMIT ?
    `,
    )
    .all(query, ...filter.params, limit);
}

function searchKnowledgeLike(tokens, limit = 20, guildId = null) {
  if (!tokens.length) {
    return [];
  }
  const filter = knowledgeGuildFilter(guildId);
  const clauses = tokens.map(
    () =>
      `(lower(d.name) LIKE ? OR lower(c.section) LIKE ? OR lower(c.content) LIKE ?)`,
  );
  const params = [];
  for (const token of tokens) {
    const like = `%${token.replace(/[%_]/g, '')}%`;
    params.push(like, like, like);
  }
  params.push(...filter.params);
  params.push(limit);
  return db
    .prepare(
      `
      SELECT d.name AS document_name, c.section, c.content, 0 AS rank, d.guild_id
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
      WHERE (${clauses.join(' OR ')})
        AND d.${filter.sql}
      LIMIT ?
    `,
    )
    .all(...params);
}

function listChunksBySection(documentName, section, guildId = null) {
  const filter = knowledgeGuildFilter(guildId);
  return db
    .prepare(
      `
      SELECT d.name AS document_name, c.section, c.content, c.chunk_index, d.guild_id
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
      WHERE d.name = ? AND c.section = ?
        AND d.${filter.sql}
      ORDER BY c.chunk_index ASC
    `,
    )
    .all(documentName, section, ...filter.params);
}

function countKnowledgeChunks(guildId = null) {
  const filter = knowledgeGuildFilter(guildId);
  const row = db
    .prepare(`SELECT COUNT(*) AS total FROM knowledge_chunks WHERE ${filter.sql}`)
    .get(...filter.params);
  return Number(row?.total || 0);
}

function listKnowledgeDocuments(guildId = null) {
  const filter = knowledgeGuildFilter(guildId);
  return db
    .prepare(
      `
      SELECT name, version, hash, status, indexed_at, guild_id, scope,
        (SELECT COUNT(*) FROM knowledge_chunks c WHERE c.document_id = d.id) AS chunks
      FROM knowledge_documents d
      WHERE ${filter.sql}
      ORDER BY scope ASC, name ASC
    `,
    )
    .all(...filter.params);
}

function logAi({
  guildId,
  userId,
  question,
  answer,
  sources,
  theme = null,
  path = null,
  latencyMs = 0,
  outcome = 'ok',
}) {
  db.prepare(
    `
    INSERT INTO ai_logs (
      guild_id, user_id, question, answer, sources, theme, path, latency_ms, outcome
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    guildId,
    userId,
    question,
    answer,
    sources ? JSON.stringify(sources) : null,
    theme,
    path,
    Number(latencyMs) || 0,
    outcome,
  );
}

function pruneAiLogs({ days = 30 } = {}) {
  const result = db
    .prepare(
      `DELETE FROM ai_logs WHERE created_at < datetime('now', ?)`,
    )
    .run(`-${Number(days)} days`);
  return Number(result.changes || 0);
}

function listAiMisses({ limit = 20, guildId = null } = {}) {
  if (guildId) {
    return db
      .prepare(
        `
        SELECT question, theme, path, outcome, created_at, user_id
        FROM ai_logs
        WHERE guild_id = ?
          AND outcome IN ('miss', 'refuse', 'clarify', 'invalid', 'catalog')
        ORDER BY id DESC
        LIMIT ?
      `,
      )
      .all(guildId, limit);
  }
  return db
    .prepare(
      `
      SELECT question, theme, path, outcome, created_at, user_id
      FROM ai_logs
      WHERE outcome IN ('miss', 'refuse', 'clarify', 'invalid', 'catalog')
      ORDER BY id DESC
      LIMIT ?
    `,
    )
    .all(limit);
}

function listAiLogs({ guildId = null, limit = 30 } = {}) {
  if (guildId) {
    return db
      .prepare(
        `
        SELECT id, user_id, theme, path, outcome, latency_ms, created_at,
          substr(question, 1, 180) AS question
        FROM ai_logs
        WHERE guild_id = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      )
      .all(guildId, limit);
  }
  return db
    .prepare(
      `
      SELECT id, user_id, theme, path, outcome, latency_ms, created_at,
        substr(question, 1, 180) AS question
      FROM ai_logs
      ORDER BY id DESC
      LIMIT ?
    `,
    )
    .all(limit);
}

function listAuditEvents({ guildId, limit = 50, offset = 0 } = {}) {
  return db
    .prepare(
      `
      SELECT id, actor_id, action, target_id, detail, created_at
      FROM audit_events
      WHERE guild_id = ?
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `,
    )
    .all(guildId, limit, offset);
}

function pruneAuditEvents({ days = 90 } = {}) {
  const result = db
    .prepare(`DELETE FROM audit_events WHERE created_at < datetime('now', ?)`)
    .run(`-${Number(days)} days`);
  return Number(result.changes || 0);
}

function insertMemberEvent({
  guildId,
  userId,
  userTag = null,
  type,
  actorId = null,
  roleId = null,
  detail = null,
  certainty = 'known',
}) {
  const result = db
    .prepare(
      `
      INSERT INTO member_events (
        guild_id, user_id, user_tag, type, actor_id, role_id, detail, certainty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(guildId, userId, userTag, type, actorId, roleId, detail, certainty);
  return Number(result.lastInsertRowid);
}

function listMemberEvents({ guildId, limit = 50, offset = 0, type = null } = {}) {
  if (type) {
    return db
      .prepare(
        `
        SELECT * FROM member_events
        WHERE guild_id = ? AND type = ?
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `,
      )
      .all(guildId, type, limit, offset);
  }
  return db
    .prepare(
      `
      SELECT * FROM member_events
      WHERE guild_id = ?
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `,
    )
    .all(guildId, limit, offset);
}

function findRecentMemberEvent({ guildId, userId, type, seconds = 8 }) {
  return db
    .prepare(
      `
      SELECT * FROM member_events
      WHERE guild_id = ?
        AND user_id = ?
        AND type = ?
        AND created_at >= datetime('now', ?)
      ORDER BY id DESC
      LIMIT 1
    `,
    )
    .get(guildId, userId, type, `-${Number(seconds)} seconds`);
}

function pruneMemberEvents({ days = 90 } = {}) {
  const result = db
    .prepare(`DELETE FROM member_events WHERE created_at < datetime('now', ?)`)
    .run(`-${Number(days)} days`);
  return Number(result.changes || 0);
}

function listFarmEntries({
  guildId,
  periodId = null,
  status = null,
  userId = null,
  limit = 50,
  offset = 0,
} = {}) {
  return db
    .prepare(
      `
      SELECT * FROM farm_entries
      WHERE guild_id = ?
        AND (? IS NULL OR period_id = ?)
        AND (? IS NULL OR status = ?)
        AND (? IS NULL OR user_id = ?)
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `,
    )
    .all(
      guildId,
      periodId,
      periodId,
      status,
      status,
      userId,
      userId,
      limit,
      offset,
    );
}

function countFarmEntries({
  guildId,
  periodId = null,
  status = null,
} = {}) {
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS total FROM farm_entries
      WHERE guild_id = ?
        AND (? IS NULL OR period_id = ?)
        AND (? IS NULL OR status = ?)
    `,
    )
    .get(guildId, periodId, periodId, status, status);
  return Number(row?.total || 0);
}

function touchHeartbeat(details = null) {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO bot_heartbeat (id, started_at, updated_at, details)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      updated_at = excluded.updated_at,
      details = excluded.details
  `,
  ).run(now, now, details);
}

function getHeartbeat() {
  return db.prepare(`SELECT * FROM bot_heartbeat WHERE id = 1`).get() || null;
}

function listBackupFiles() {
  const dir = path.resolve(process.env.BACKUP_PATH || './data/backups');
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('farm-') && name.endsWith('.sqlite'))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return {
        name,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

function withTransaction(fn) {
  return db.transaction(fn)();
}

async function backupDatabase() {
  const dir = path.resolve(process.env.BACKUP_PATH || './data/backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(dir, `farm-${stamp}.sqlite`);
  await db.backup(dest);
  const keep = Number(process.env.BACKUP_KEEP || 7);
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('farm-') && name.endsWith('.sqlite'))
    .sort();
  while (files.length > keep) {
    const old = files.shift();
    try {
      fs.unlinkSync(path.join(dir, old));
    } catch {
      // ignore
    }
  }
  return dest;
}

const AI_HISTORY_KEEP = 20;

function appendAiChat({ guildId, userId, role, content }) {
  if (!userId || !content) {
    return;
  }
  const guild = guildId || '';
  db.prepare(
    `
    INSERT INTO ai_chat_history (guild_id, user_id, role, content)
    VALUES (?, ?, ?, ?)
  `,
  ).run(guild, userId, role, content);
  db.prepare(
    `
    DELETE FROM ai_chat_history
    WHERE guild_id = ? AND user_id = ?
      AND id NOT IN (
        SELECT id FROM ai_chat_history
        WHERE guild_id = ? AND user_id = ?
        ORDER BY id DESC
        LIMIT ?
      )
  `,
  ).run(guild, userId, guild, userId, AI_HISTORY_KEEP);
}

function listAiChat({ guildId, userId, limit = 8 }) {
  if (!userId) {
    return [];
  }
  return db
    .prepare(
      `
      SELECT role, content
      FROM ai_chat_history
      WHERE guild_id = ? AND user_id = ?
      ORDER BY id DESC
      LIMIT ?
    `,
    )
    .all(guildId || '', userId, limit)
    .reverse();
}

function getAiUserTopic({ guildId, userId }) {
  if (!userId) {
    return null;
  }
  const row = db
    .prepare(
      `
      SELECT topic, query, chunks_json, updated_at
      FROM ai_user_topics
      WHERE guild_id = ? AND user_id = ?
    `,
    )
    .get(guildId || '', userId);
  if (!row) {
    return null;
  }
  let chunks = [];
  try {
    chunks = JSON.parse(row.chunks_json || '[]');
  } catch {
    chunks = [];
  }
  return {
    topic: row.topic,
    query: row.query,
    chunks,
    at: Number(row.updated_at) || 0,
  };
}

function setAiUserTopic({ guildId, userId, topic, query, chunks }) {
  if (!userId) {
    return;
  }
  db.prepare(
    `
    INSERT INTO ai_user_topics (guild_id, user_id, topic, query, chunks_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      topic = excluded.topic,
      query = excluded.query,
      chunks_json = excluded.chunks_json,
      updated_at = excluded.updated_at
  `,
  ).run(
    guildId || '',
    userId,
    topic || null,
    query || null,
    JSON.stringify(chunks || []),
    Date.now(),
  );
}

function upsertGuild(row) {
  db.prepare(
    `
    INSERT INTO guilds (id, name, icon, owner_id, member_count, status, joined_at, fetched_at, updated_at)
    VALUES (@id, @name, @icon, @ownerId, @memberCount, 'active', datetime('now'), datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      icon = excluded.icon,
      owner_id = excluded.owner_id,
      member_count = excluded.member_count,
      status = 'active',
      left_at = NULL,
      fetched_at = excluded.fetched_at,
      updated_at = datetime('now')
  `,
  ).run({
    id: String(row.id),
    name: row.name || null,
    icon: row.icon || null,
    ownerId: row.ownerId || row.owner_id || null,
    memberCount: row.memberCount ?? row.member_count ?? null,
  });
  return getGuild(row.id);
}

function getGuild(guildId) {
  return db.prepare(`SELECT * FROM guilds WHERE id = ?`).get(String(guildId));
}

function markGuildInactive(guildId) {
  db.prepare(
    `
    UPDATE guilds
    SET status = 'inactive', left_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `,
  ).run(String(guildId));
  return getGuild(guildId);
}

function upsertUser(userId, tag) {
  if (!userId) {
    return;
  }
  db.prepare(
    `
    INSERT INTO users (id, tag, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET tag = excluded.tag, updated_at = datetime('now')
  `,
  ).run(String(userId), tag || null);
}

function upsertGuildMember({ guildId, userId, tag, status = 'active' }) {
  upsertUser(userId, tag);
  db.prepare(
    `
    INSERT INTO guild_members (guild_id, user_id, tag, status, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      tag = excluded.tag,
      status = excluded.status,
      updated_at = datetime('now')
  `,
  ).run(String(guildId), String(userId), tag || null, status);
}

function ensureDefaultEntitlement(guildId) {
  db.prepare(
    `
    INSERT INTO ai_entitlements (guild_id, plan, status, monthly_limit, source)
    VALUES (?, 'internal', 'active', 0, 'manual')
    ON CONFLICT(guild_id) DO NOTHING
  `,
  ).run(String(guildId));
  return db
    .prepare(`SELECT * FROM ai_entitlements WHERE guild_id = ?`)
    .get(String(guildId));
}

function getEntitlement(guildId) {
  return ensureDefaultEntitlement(guildId);
}

function setEntitlement(guildId, patch) {
  const current = getEntitlement(guildId);
  db.prepare(
    `
    UPDATE ai_entitlements
    SET plan = @plan,
        status = @status,
        monthly_limit = @monthlyLimit,
        source = @source,
        starts_at = @startsAt,
        ends_at = @endsAt,
        updated_at = datetime('now')
    WHERE guild_id = @guildId
  `,
  ).run({
    guildId: String(guildId),
    plan: patch.plan || current.plan,
    status: patch.status || current.status,
    monthlyLimit: patch.monthlyLimit ?? current.monthly_limit,
    source: patch.source || current.source,
    startsAt: patch.startsAt ?? current.starts_at,
    endsAt: patch.endsAt ?? current.ends_at,
  });
  return getEntitlement(guildId);
}

function countUsageThisMonth(guildId) {
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM ai_usage_events
      WHERE guild_id = ?
        AND status IN ('ok', 'reserved', 'committed')
        AND created_at >= datetime('now', 'start of month')
    `,
    )
    .get(String(guildId));
  return Number(row?.total || 0);
}

function insertUsageEvent(event) {
  const previous = db
    .prepare(`SELECT status FROM ai_usage_events WHERE request_id = ?`)
    .get(event.requestId);
  db.prepare(
    `
    INSERT INTO ai_usage_events (
      request_id, guild_id, user_id, operation, provider, model, status,
      input_tokens, output_tokens, estimated_cost, latency_ms, retries
    ) VALUES (
      @requestId, @guildId, @userId, @operation, @provider, @model, @status,
      @inputTokens, @outputTokens, @estimatedCost, @latencyMs, @retries
    )
    ON CONFLICT(request_id) DO UPDATE SET
      status = excluded.status,
      model = excluded.model,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      estimated_cost = excluded.estimated_cost,
      latency_ms = excluded.latency_ms,
      retries = excluded.retries
  `,
  ).run({
    requestId: event.requestId,
    guildId: String(event.guildId),
    userId: event.userId || null,
    operation: event.operation || 'question',
    provider: event.provider || 'openrouter',
    model: event.model || null,
    status: event.status,
    inputTokens: event.inputTokens ?? null,
    outputTokens: event.outputTokens ?? null,
    estimatedCost: event.estimatedCost ?? null,
    latencyMs: event.latencyMs ?? null,
    retries: event.retries ?? 0,
  });
  const alreadyCounted =
    previous?.status === 'ok' || previous?.status === 'committed';
  if (
    (event.status === 'ok' || event.status === 'committed') &&
    !alreadyCounted
  ) {
    const day = new Date().toISOString().slice(0, 10);
    db.prepare(
      `
      INSERT INTO ai_usage_daily (guild_id, day, requests, input_tokens, output_tokens, estimated_cost)
      VALUES (@guildId, @day, 1, @inputTokens, @outputTokens, @estimatedCost)
      ON CONFLICT(guild_id, day) DO UPDATE SET
        requests = requests + 1,
        input_tokens = input_tokens + excluded.input_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        estimated_cost = estimated_cost + excluded.estimated_cost
    `,
    ).run({
      guildId: String(event.guildId),
      day,
      inputTokens: Number(event.inputTokens || 0),
      outputTokens: Number(event.outputTokens || 0),
      estimatedCost: Number(event.estimatedCost || 0),
    });
  }
}

function listUsageDaily(guildId, { limit = 31 } = {}) {
  return db
    .prepare(
      `
      SELECT * FROM ai_usage_daily
      WHERE guild_id = ?
      ORDER BY day DESC
      LIMIT ?
    `,
    )
    .all(String(guildId), limit);
}

function recordBillingEvent({ provider, externalEventId, eventType, payloadHash }) {
  const result = db
    .prepare(
      `
      INSERT OR IGNORE INTO billing_events (provider, external_event_id, event_type, payload_hash)
      VALUES (?, ?, ?, ?)
    `,
    )
    .run(provider, externalEventId, eventType || null, payloadHash || null);
  return result.changes > 0;
}

function getGuildCatalog(guildId, kind) {
  return db
    .prepare(`SELECT * FROM guild_catalogs WHERE guild_id = ? AND kind = ?`)
    .get(String(guildId), kind);
}

function saveGuildCatalog({ guildId, kind, payload, createdBy }) {
  db.prepare(
    `
    INSERT INTO guild_catalogs (guild_id, kind, version, payload_json, created_by)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(guild_id, kind) DO UPDATE SET
      version = version + 1,
      payload_json = excluded.payload_json,
      created_by = excluded.created_by,
      created_at = datetime('now')
  `,
  ).run(String(guildId), kind, JSON.stringify(payload), createdBy || null);
  return getGuildCatalog(guildId, kind);
}

function listGuildCatalogs(guildId) {
  return db
    .prepare(`SELECT kind, version, created_at FROM guild_catalogs WHERE guild_id = ?`)
    .all(String(guildId));
}

module.exports = {
  db,
  databasePath,
  ensureCurrentPeriod,
  getSettings,
  setSetting,
  syncEnvRoleSettings,
  bootstrapEnvRolesIfNeeded,
  envRoleId,
  roleIdFromEnv,
  ROLE_ENV,
  listMaterials,
  getMaterial,
  getMaterialById,
  addMaterial,
  deactivateMaterial,
  insertEntry,
  getEntry,
  updateEntry,
  deleteEntry,
  setEntryStatus,
  listPending,
  ownTotals,
  ranking,
  totalsByMaterial,
  userTotals,
  userMaterialTotal,
  guildMaterialTotal,
  upsertGoal,
  listGoals,
  replaceKnowledge,
  searchKnowledge,
  searchKnowledgeLike,
  listChunksBySection,
  countKnowledgeChunks,
  listKnowledgeDocuments,
  logAi,
  pruneAiLogs,
  listAiMisses,
  listAiLogs,
  listAuditEvents,
  pruneAuditEvents,
  insertMemberEvent,
  listMemberEvents,
  findRecentMemberEvent,
  pruneMemberEvents,
  listFarmEntries,
  countFarmEntries,
  touchHeartbeat,
  getHeartbeat,
  listBackupFiles,
  withTransaction,
  backupDatabase,
  findRecentDuplicate,
  appendAiChat,
  listAiChat,
  getAiUserTopic,
  setAiUserTopic,
  insertAuditEvent,
  upsertGuild,
  getGuild,
  markGuildInactive,
  upsertUser,
  upsertGuildMember,
  ensureDefaultEntitlement,
  getEntitlement,
  setEntitlement,
  countUsageThisMonth,
  insertUsageEvent,
  listUsageDaily,
  recordBillingEvent,
  getGuildCatalog,
  saveGuildCatalog,
  listGuildCatalogs,
};
