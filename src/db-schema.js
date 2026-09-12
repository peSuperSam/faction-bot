function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function addColumnIfMissing(db, table, name, definition) {
  if (!tableColumns(db, table).includes(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function migrateKnowledgeGuildScope(db) {
  const cols = tableColumns(db, 'knowledge_documents');
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
  addColumnIfMissing(db, 'knowledge_chunks', 'guild_id', "TEXT NOT NULL DEFAULT '__global__'");
  if (rebuiltDocs || !knowledgeFtsHasGuildColumn(db)) {
    rebuildKnowledgeFts(db, { reindex: true });
  }
}

function knowledgeFtsHasGuildColumn(db) {
  try {
    db.prepare(`SELECT guild_id FROM knowledge_fts LIMIT 1`).get();
    return true;
  } catch {
    return false;
  }
}

function rebuildKnowledgeFts(db, { reindex = false } = {}) {
  if (knowledgeFtsHasGuildColumn(db) && !reindex) {
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

function migrate(db) {
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

  addColumnIfMissing(db, 'farm_entries', 'status', "TEXT NOT NULL DEFAULT 'approved'");
  addColumnIfMissing(db, 'farm_entries', 'period_id', 'INTEGER');
  addColumnIfMissing(db, 'farm_entries', 'reviewed_by', 'TEXT');
  addColumnIfMissing(db, 'farm_entries', 'reviewed_at', 'TEXT');
  addColumnIfMissing(db, 'guild_settings', 'ai_channel_id', 'TEXT');
  addColumnIfMissing(db, 'guild_settings', 'admin_channel_id', 'TEXT');
  addColumnIfMissing(db, 'guild_settings', 'farm_channel_id', 'TEXT');
  addColumnIfMissing(db, 'guild_settings', 'farm_panel_message_id', 'TEXT');
  addColumnIfMissing(db, 'guild_settings', 'auto_approve', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'ai_logs', 'theme', 'TEXT');
  addColumnIfMissing(db, 'ai_logs', 'path', 'TEXT');
  addColumnIfMissing(db, 'ai_logs', 'latency_ms', 'INTEGER');
  addColumnIfMissing(db, 'ai_logs', 'outcome', "TEXT NOT NULL DEFAULT 'ok'");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_farm_entries_guild_period
      ON farm_entries (guild_id, period_id, status);
    CREATE INDEX IF NOT EXISTS idx_member_events_guild_created
      ON member_events (guild_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_guild_created
      ON audit_events (guild_id, created_at DESC);
  `);
  addColumnIfMissing(db, 'guild_settings', 'setup_status', "TEXT NOT NULL DEFAULT 'pending'");
  addColumnIfMissing(db, 'guild_settings', 'identity_name', 'TEXT');
  addColumnIfMissing(db, 'guild_settings', 'presence_text', 'TEXT');
  addColumnIfMissing(db, 'ai_logs', 'request_id', 'TEXT');
  migrateKnowledgeGuildScope(db);
}

module.exports = {
  migrate,
  tableColumns,
  addColumnIfMissing,
  migrateKnowledgeGuildScope,
  rebuildKnowledgeFts,
};
