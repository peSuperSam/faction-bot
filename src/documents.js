const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  db,
  withTransaction,
  insertAuditEvent,
  replaceKnowledge,
  getGuildCatalog,
  saveGuildCatalog,
  listGuildCatalogs,
} = require('./db');
const { BOT_NAME, GUILD_SCOPE } = require('./brand');
const { chunkText } = require('./knowledge-util');

const MAX_DOCUMENT_CHARS = 256_000;
const ALLOWED_EXT = new Set(['.md', '.txt']);

function documentsRoot(guildId) {
  return path.resolve(`./data/guilds/${guildId}/documents`);
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function sanitizeSlug(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '')
    .toLowerCase()
    .slice(0, 180);
}

function writeDocumentFile(guildId, slug, content) {
  const root = documentsRoot(guildId);
  const ext = path.extname(slug) && ALLOWED_EXT.has(path.extname(slug)) ? '' : '.md';
  const relative = `${slug}${ext}`.replace(/\.md\.md$/, '.md');
  const full = path.join(root, relative);
  if (!full.startsWith(root)) {
    throw Object.assign(new Error('Caminho de documento inválido.'), { status: 400 });
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return relative;
}

function listDocuments(guildId) {
  return db
    .prepare(
      `
      SELECT d.*,
        (SELECT version_number FROM guild_document_versions v
         WHERE v.document_id = d.id AND v.status = 'published'
         ORDER BY version_number DESC LIMIT 1) AS published_version
      FROM guild_documents d
      WHERE d.guild_id = ?
      ORDER BY d.updated_at DESC
    `,
    )
    .all(String(guildId));
}

function getDocument(guildId, id) {
  const doc = db
    .prepare(`SELECT * FROM guild_documents WHERE guild_id = ? AND id = ?`)
    .get(String(guildId), Number(id));
  if (!doc) {
    throw Object.assign(new Error('Documento não encontrado.'), { status: 404 });
  }
  const versions = db
    .prepare(
      `
      SELECT id, version_number, status, content_hash, change_message, created_by, created_at, published_at
      FROM guild_document_versions
      WHERE document_id = ?
      ORDER BY version_number DESC
    `,
    )
    .all(doc.id);
  const draft = db
    .prepare(
      `
      SELECT * FROM guild_document_versions
      WHERE document_id = ? AND status = 'draft'
      ORDER BY version_number DESC
      LIMIT 1
    `,
    )
    .get(doc.id);
  const published = doc.current_published_version_id
    ? db
        .prepare(`SELECT * FROM guild_document_versions WHERE id = ?`)
        .get(doc.current_published_version_id)
    : null;
  return { document: doc, versions, draft, published };
}

function createDocument(guildId, actor, payload) {
  const slug = sanitizeSlug(payload.slug || payload.name || payload.title);
  const title = String(payload.title || slug).trim();
  const content = String(payload.content || '').trim();
  if (!slug || !title) {
    throw Object.assign(new Error('Informe título e identificador do documento.'), { status: 400 });
  }
  if (content.length > MAX_DOCUMENT_CHARS) {
    throw Object.assign(new Error('Documento grande demais.'), { status: 413 });
  }
  const existing = db
    .prepare(`SELECT id FROM guild_documents WHERE guild_id = ? AND slug = ?`)
    .get(String(guildId), slug);
  if (existing) {
    throw Object.assign(new Error('Já existe um documento com esse identificador.'), { status: 409 });
  }
  const result = db
    .prepare(
      `
      INSERT INTO guild_documents (guild_id, slug, title, category, status, created_by)
      VALUES (?, ?, ?, ?, 'draft', ?)
    `,
    )
    .run(String(guildId), slug, title, payload.category || null, actor.userId);
  const documentId = Number(result.lastInsertRowid);
  db.prepare(
    `
    INSERT INTO guild_document_versions
      (document_id, guild_id, version_number, content, content_hash, status, created_by, change_message)
    VALUES (?, ?, 1, ?, ?, 'draft', ?, ?)
  `,
  ).run(
    documentId,
    String(guildId),
    content,
    hashContent(content),
    actor.userId,
    payload.message || 'criação',
  );
  writeDocumentFile(guildId, slug, content);
  insertAuditEvent({
    guildId,
    actorId: actor.userId,
    action: 'document.create',
    targetId: String(documentId),
    detail: slug,
  });
  return getDocument(guildId, documentId);
}

function updateDraft(guildId, id, actor, payload) {
  const current = getDocument(guildId, id);
  const content = String(payload.content ?? current.draft?.content ?? '').trim();
  const title = String(payload.title || current.document.title).trim();
  if (content.length > MAX_DOCUMENT_CHARS) {
    throw Object.assign(new Error('Documento grande demais.'), { status: 413 });
  }
  db.prepare(
    `UPDATE guild_documents SET title = ?, category = ?, updated_at = datetime('now') WHERE id = ? AND guild_id = ?`,
  ).run(title, payload.category ?? current.document.category, current.document.id, String(guildId));
  if (current.draft) {
    db.prepare(
      `
      UPDATE guild_document_versions
      SET content = ?, content_hash = ?, created_by = ?, change_message = ?, created_at = datetime('now')
      WHERE id = ?
    `,
    ).run(
      content,
      hashContent(content),
      actor.userId,
      payload.message || 'edição',
      current.draft.id,
    );
  } else {
    const next = Number(current.versions[0]?.version_number || 0) + 1;
    db.prepare(
      `
      INSERT INTO guild_document_versions
        (document_id, guild_id, version_number, content, content_hash, status, created_by, change_message)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)
    `,
    ).run(
      current.document.id,
      String(guildId),
      next,
      content,
      hashContent(content),
      actor.userId,
      payload.message || 'edição',
    );
  }
  writeDocumentFile(guildId, current.document.slug, content);
  insertAuditEvent({
    guildId,
    actorId: actor.userId,
    action: 'document.update',
    targetId: String(id),
  });
  return getDocument(guildId, id);
}

function listVersions(guildId, id) {
  return getDocument(guildId, id).versions;
}

function getVersion(guildId, id, versionNumber) {
  const current = getDocument(guildId, id);
  const version = db
    .prepare(
      `
      SELECT * FROM guild_document_versions
      WHERE document_id = ? AND version_number = ?
    `,
    )
    .get(current.document.id, Number(versionNumber));
  if (!version) {
    throw Object.assign(new Error('Versão não encontrada.'), { status: 404 });
  }
  return version;
}

function restoreVersion(guildId, id, actor, versionNumber) {
  const version = getVersion(guildId, id, versionNumber);
  return updateDraft(guildId, id, actor, {
    content: version.content,
    message: `restaurado da v${version.version_number}`,
  });
}

function validateDocumentContent(content, name) {
  const errors = [];
  if (!String(content || '').trim()) {
    errors.push(`${name}: vazio`);
    return errors;
  }
  if (chunkText(content).length === 0) {
    errors.push(`${name}: sem conteúdo indexável`);
  }
  return errors;
}

function validateDocuments(guildId, documentIds) {
  const ids = documentIds?.length ? documentIds : listDocuments(guildId).map((row) => row.id);
  const rejected = [];
  const accepted = [];
  for (const id of ids) {
    const current = getDocument(guildId, id);
    const source = current.draft || current.published;
    if (!source) {
      rejected.push(`${current.document.slug}: sem conteúdo`);
      continue;
    }
    const errors = validateDocumentContent(source.content, current.document.slug);
    if (errors.length) {
      rejected.push(...errors);
      continue;
    }
    accepted.push(current);
  }
  return { ok: rejected.length === 0, rejected, accepted };
}

function publishedItemsForGuild(guildId) {
  return listDocuments(guildId)
    .filter((row) => row.status === 'published')
    .map((row) => getDocument(guildId, row.id));
}

function indexGuildDocuments(guildId, items) {
  const documents = (items || [])
    .map((item) => {
      const source = item.published || item.draft;
      if (!source?.content) {
        return null;
      }
      return {
        name: item.document.slug,
        version: source.version_number,
        hash: source.content_hash,
        versionId: String(source.id),
        sourceType: 'guild',
        chunks: chunkText(source.content),
      };
    })
    .filter(Boolean);
  replaceKnowledge(documents, { guildId: String(guildId), scope: GUILD_SCOPE });
}

function reindexPublishedGuildDocs(guildId) {
  indexGuildDocuments(guildId, publishedItemsForGuild(guildId));
}

function publishDocuments(guildId, actor, payload = {}) {
  const validation = validateDocuments(guildId, payload.documentIds);
  if (!validation.ok) {
    return { ok: false, rejected: validation.rejected };
  }
  const last = db
    .prepare(
      `SELECT COALESCE(MAX(release_number), 0) AS n FROM knowledge_releases WHERE guild_id = ?`,
    )
    .get(String(guildId));
  const releaseNumber = Number(last?.n || 0) + 1;
  let releaseId;
  withTransaction(() => {
    const release = db
      .prepare(
        `
        INSERT INTO knowledge_releases (guild_id, release_number, status, created_by, message, published_at)
        VALUES (?, ?, 'published', ?, ?, datetime('now'))
      `,
      )
      .run(String(guildId), releaseNumber, actor.userId, payload.message || null);
    releaseId = Number(release.lastInsertRowid);
    const publishedItems = [];
    for (const item of validation.accepted) {
      let version = item.draft;
      if (version) {
        db.prepare(
          `
          UPDATE guild_document_versions
          SET status = 'published', published_at = datetime('now')
          WHERE id = ?
        `,
        ).run(version.id);
      } else {
        version = item.published;
      }
      db.prepare(
        `
        UPDATE guild_documents
        SET status = 'published',
            current_published_version_id = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `,
      ).run(version.id, item.document.id);
      db.prepare(
        `
        INSERT INTO knowledge_release_documents (release_id, document_id, version_id)
        VALUES (?, ?, ?)
      `,
      ).run(releaseId, item.document.id, version.id);
      publishedItems.push({
        ...item,
        draft: null,
        published: { ...version, status: 'published' },
      });
    }
    indexGuildDocuments(guildId, publishedItemsForGuild(guildId));
  });
  insertAuditEvent({
    guildId,
    actorId: actor.userId,
    action: 'documents.publish',
    targetId: String(releaseId),
    detail: `release=${releaseNumber}`,
  });
  return {
    ok: true,
    releaseId,
    releaseNumber,
    indexed: validation.accepted.length,
    rejected: [],
  };
}

function listReleases(guildId) {
  return db
    .prepare(
      `
      SELECT * FROM knowledge_releases
      WHERE guild_id = ?
      ORDER BY release_number DESC
    `,
    )
    .all(String(guildId));
}

function rollbackRelease(guildId, actor, releaseId) {
  const release = db
    .prepare(`SELECT * FROM knowledge_releases WHERE guild_id = ? AND id = ?`)
    .get(String(guildId), Number(releaseId));
  if (!release) {
    throw Object.assign(new Error('Release não encontrada.'), { status: 404 });
  }
  const rows = db
    .prepare(
      `
      SELECT document_id, version_id
      FROM knowledge_release_documents
      WHERE release_id = ?
    `,
    )
    .all(release.id);
  for (const row of rows) {
    const version = db
      .prepare(`SELECT * FROM guild_document_versions WHERE id = ?`)
      .get(row.version_id);
    if (version) {
      updateDraft(guildId, row.document_id, actor, {
        content: version.content,
        message: `rollback da release ${release.release_number}`,
      });
    }
  }
  return publishDocuments(guildId, actor, {
    documentIds: rows.map((row) => row.document_id),
    message: `rollback da release ${release.release_number}`,
  });
}

function archiveDocument(guildId, id, actor) {
  const current = getDocument(guildId, id);
  db.prepare(
    `UPDATE guild_documents SET status = 'archived', updated_at = datetime('now') WHERE id = ? AND guild_id = ?`,
  ).run(current.document.id, String(guildId));
  insertAuditEvent({
    guildId,
    actorId: actor.userId,
    action: 'document.archive',
    targetId: String(id),
  });
  return getDocument(guildId, id);
}

function importCatalog(guildId, actor, kind, items) {
  saveGuildCatalog({
    guildId,
    kind,
    payload: items,
    createdBy: actor.userId,
  });
  insertAuditEvent({
    guildId,
    actorId: actor.userId,
    action: 'catalog.import',
    detail: kind,
  });
  return { ok: true, catalogs: listGuildCatalogs(guildId) };
}

module.exports = {
  BOT_NAME,
  listDocuments,
  getDocument,
  createDocument,
  updateDraft,
  listVersions,
  getVersion,
  restoreVersion,
  validateDocuments,
  publishDocuments,
  listReleases,
  rollbackRelease,
  archiveDocument,
  importCatalog,
  getGuildCatalog,
  listGuildCatalogs,
  reindexPublishedGuildDocs,
  hashContent,
};
