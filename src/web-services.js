const {
  ensureCurrentPeriod,
  getSettings,
  setSetting,
  listMaterials,
  getMaterial,
  addMaterial,
  deactivateMaterial,
  getEntry,
  updateEntry,
  deleteEntry,
  setEntryStatus,
  listPending,
  ranking,
  totalsByMaterial,
  userTotals,
  userMaterialTotal,
  guildMaterialTotal,
  upsertGoal,
  listGoals,
  insertAuditEvent,
  withTransaction,
  listFarmEntries,
  countFarmEntries,
  listAuditEvents,
  listMemberEvents,
  listAiMisses,
  listAiLogs,
  listKnowledgeDocuments,
  backupDatabase,
  listBackupFiles,
  getHeartbeat,
  getGuild,
  upsertGuild,
} = require('./db');
const { listKnowledgeDocuments: knowledgeDocs, reloadKnowledge } = require('./knowledge');
const { inspectQuestion } = require('./ai-router');
const { circuitState } = require('./ai-llm');
const { getAiContextTopic } = require('./user-context');
const { farmBoardMessage } = require('./farm-commands');
const { logEmbed } = require('./embeds');
const { displayMaterial, formatQuantity, parsePositiveInt, truncate } = require('./util');
const rest = require('./discord-rest');
const documents = require('./documents');
const { BOT_NAME } = require('./brand');
const { usageSummary, getEntitlementState } = require('./ai-entitlement');
const {
  validatePrices,
  validateActions,
  validatePartnerships,
} = require('./catalogs');

function goalsWithProgress(guildId, periodId, onlyUserId = null) {
  return listGoals(guildId, periodId)
    .filter((goal) => {
      if (!onlyUserId) {
        return true;
      }
      return (
        (goal.scope === 'user' && goal.user_id === onlyUserId) ||
        goal.scope === 'guild'
      );
    })
    .map((goal) => ({
      ...goal,
      current:
        goal.scope === 'user'
          ? userMaterialTotal(guildId, periodId, goal.user_id, goal.material)
          : guildMaterialTotal(guildId, periodId, goal.material),
    }));
}

function publicSettings(settings) {
  return {
    guildId: settings.guild_id,
    leaderRoleId: settings.leader_role_id,
    managerRoleId: settings.manager_role_id,
    memberRoleId: settings.member_role_id,
    logChannelId: settings.log_channel_id,
    aiChannelId: settings.ai_channel_id,
    adminChannelId: settings.admin_channel_id,
    farmChannelId: settings.farm_channel_id,
    farmPanelMessageId: settings.farm_panel_message_id,
    autoApprove: Number(settings.auto_approve) !== 0,
    identityName: settings.identity_name || BOT_NAME,
    presenceText: settings.presence_text || null,
    lockedRoles: {
      leader: false,
      manager: false,
      member: false,
    },
  };
}

function periodDto(period) {
  return {
    id: period.id,
    key: period.key,
    startsAt: period.starts_at,
    endsAt: period.ends_at,
    status: period.status,
    label: period.week?.label || period.key,
  };
}

async function notifyLog(guildId, title, description, actorTag, discord = rest) {
  const settings = getSettings(guildId);
  if (!settings.log_channel_id) {
    return;
  }
  try {
    await discord.sendMessage(
      settings.log_channel_id,
      rest.toRestPayload({
        allowedMentions: { parse: ['users'] },
        embeds: [logEmbed(title, description, actorTag || 'painel web')],
      }),
    );
  } catch (error) {
    console.error('Falha ao enviar log do painel:', error.message);
  }
}

function audit({ guildId, actorId, action, targetId = null, detail = null }) {
  insertAuditEvent({ guildId, actorId, action, targetId, detail });
}

function getDashboard(guildId) {
  const period = ensureCurrentPeriod(guildId);
  const materials = listMaterials(guildId);
  const goals = goalsWithProgress(guildId, period.id).filter(
    (goal) => goal.scope === 'guild',
  );
  const totals = totalsByMaterial(guildId, period.id);
  const rank = ranking(guildId, period.id, null, 10);
  const pending = listPending(guildId, period.id);
  return {
    period: periodDto(period),
    materials: materials.map((item) => ({
      id: item.id,
      name: item.name,
      displayName: item.display_name,
      active: item.active,
    })),
    goals: goals.map((goal) => ({
      id: goal.id,
      material: goal.material,
      displayName: displayMaterial(goal.material),
      quantity: goal.quantity,
      current: goal.current,
      scope: goal.scope,
    })),
    totals: totals.map((row) => ({
      material: row.material,
      displayName: displayMaterial(row.material),
      total: Number(row.total || 0),
      entries: Number(row.entries || 0),
    })),
    ranking: rank.map((row, index) => ({
      position: index + 1,
      userId: row.user_id,
      userTag: row.user_tag,
      total: Number(row.total || 0),
    })),
    pendingCount: pending.length,
    approvedCount: countFarmEntries({
      guildId,
      periodId: period.id,
      status: 'approved',
    }),
    settings: publicSettings(getSettings(guildId)),
  };
}

function getFarmPage(guildId, { status = null, limit = 40, offset = 0 } = {}) {
  const period = ensureCurrentPeriod(guildId);
  const entries = listFarmEntries({
    guildId,
    periodId: period.id,
    status: status || null,
    limit,
    offset,
  }).map((entry) => ({
    id: entry.id,
    userId: entry.user_id,
    userTag: entry.user_tag,
    material: entry.material,
    displayName: displayMaterial(entry.material),
    quantity: entry.quantity,
    note: entry.note,
    status: entry.status,
    createdAt: entry.created_at,
    reviewedBy: entry.reviewed_by,
    reviewedAt: entry.reviewed_at,
  }));
  return {
    period: periodDto(period),
    entries,
    total: countFarmEntries({ guildId, periodId: period.id, status: status || null }),
    pending: listPending(guildId, period.id).map((entry) => ({
      id: entry.id,
      userId: entry.user_id,
      userTag: entry.user_tag,
      material: entry.material,
      quantity: entry.quantity,
      createdAt: entry.created_at,
    })),
    ranking: ranking(guildId, period.id, null, 15).map((row, index) => ({
      position: index + 1,
      userId: row.user_id,
      userTag: row.user_tag,
      total: Number(row.total || 0),
    })),
  };
}

async function getMembersPage(guildId, discord = rest) {
  const period = ensureCurrentPeriod(guildId);
  const settings = getSettings(guildId);
  const farmed = new Map(
    userTotals(guildId, period.id).map((row) => [row.user_id, Number(row.total || 0)]),
  );
  let members = [];
  let warning = null;
  try {
    const listed = await discord.listMembers(guildId);
    members = listed
      .filter((member) => !member.user?.bot)
      .map((member) => {
        const roles = member.roles || [];
        const tags = [];
        if (settings.leader_role_id && roles.includes(settings.leader_role_id)) {
          tags.push('líder');
        }
        if (settings.manager_role_id && roles.includes(settings.manager_role_id)) {
          tags.push('gerente');
        }
        if (settings.member_role_id && roles.includes(settings.member_role_id)) {
          tags.push('membro');
        }
        return {
          userId: member.user.id,
          tag: member.user.global_name || member.user.username,
          username: member.user.username,
          joinedAt: member.joined_at,
          nick: member.nick || null,
          roles: tags,
          farmTotal: farmed.get(member.user.id) || 0,
          farmed: farmed.has(member.user.id),
        };
      });
  } catch (error) {
    warning =
      error.status === 403
        ? 'Ative Server Members Intent no portal do Discord para listar membros.'
        : `Não foi possível listar membros: ${error.message}`;
  }
  const faction = settings.member_role_id
    ? members.filter((member) => member.roles.includes('membro') || member.roles.includes('líder') || member.roles.includes('gerente'))
    : members;
  return {
    period: periodDto(period),
    warning,
    members: faction,
    absentees: faction.filter((member) => !member.farmed),
    events: listMemberEvents({ guildId, limit: 40 }).map(memberEventDto),
  };
}

function memberEventDto(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userTag: row.user_tag,
    type: row.type,
    actorId: row.actor_id,
    roleId: row.role_id,
    detail: row.detail,
    certainty: row.certainty,
    createdAt: row.created_at,
  };
}

function getAuditPage(guildId, { limit = 50, offset = 0 } = {}) {
  return {
    events: listAuditEvents({ guildId, limit, offset }).map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      action: row.action,
      targetId: row.target_id,
      detail: row.detail,
      createdAt: row.created_at,
    })),
  };
}

function getAiPage(guildId) {
  const usage = usageSummary(guildId);
  return {
    documents: (knowledgeDocs(guildId) || listKnowledgeDocuments(guildId)).map((doc) => ({
      name: doc.name,
      version: doc.version,
      chunks: doc.chunks,
      indexedAt: doc.indexed_at,
      status: doc.status,
      scope: doc.scope,
      guildId: doc.guild_id,
    })),
    guildDocuments: documents.listDocuments(guildId).map(publicGuildDocument),
    misses: listAiMisses({ guildId, limit: 25 }).map((row) => ({
      question: row.question,
      theme: row.theme,
      path: row.path,
      outcome: row.outcome,
      createdAt: row.created_at,
      userId: row.user_id,
    })),
    recent: listAiLogs({ guildId, limit: 25 }).map((row) => ({
      id: row.id,
      userId: row.user_id,
      theme: row.theme,
      path: row.path,
      outcome: row.outcome,
      latencyMs: row.latency_ms,
      question: row.question,
      createdAt: row.created_at,
    })),
    circuit: circuitState(),
    entitlement: usage.entitlement,
    usage: usage.daily,
  };
}

function diagnoseQuestion(guildId, userId, question) {
  const prior = getAiContextTopic({
    guildId,
    userId,
    channelId: getSettings(guildId).ai_channel_id || 'web',
  });
  return inspectQuestion({ question, prior, guildId });
}

function getStatus() {
  const heartbeat = getHeartbeat();
  const ageMs = heartbeat?.updated_at
    ? Date.now() - Date.parse(`${heartbeat.updated_at}Z`)
    : null;
  const connected = ageMs != null && Number.isFinite(ageMs) && ageMs < 90_000;
  return {
    api: 'ok',
    bot: {
      connected,
      ageMs,
      details: heartbeat?.details || null,
      updatedAt: heartbeat?.updated_at || null,
    },
    circuit: circuitState(),
    backups: listBackupFiles().slice(0, 8),
    time: new Date().toISOString(),
  };
}

function saveGoals(guildId, actor, updates, discord = rest) {
  const period = ensureCurrentPeriod(guildId);
  const saved = [];
  withTransaction(() => {
    for (const update of updates) {
      const material = getMaterial(guildId, update.material);
      if (!material) {
        const error = new Error(`Material fora do catálogo: ${update.material}`);
        error.status = 400;
        throw error;
      }
      const quantity = parsePositiveInt(update.quantity);
      if (!quantity) {
        const error = new Error(`Quantidade inválida para ${material.display_name}.`);
        error.status = 400;
        throw error;
      }
      saved.push(
        upsertGoal({
          guildId,
          material: material.name,
          quantity,
          scope: 'guild',
          userId: null,
          periodId: period.id,
        }),
      );
    }
    audit({
      guildId,
      actorId: actor.userId,
      action: 'farm.goals.web',
      detail: saved.map((goal) => `${goal.material}=${goal.quantity}`).join(', '),
    });
  });
  notifyLog(
    guildId,
    'Metas atualizadas',
    saved
      .map(
        (goal) =>
          `• **${displayMaterial(goal.material)}**: ${formatQuantity(goal.quantity)}`,
      )
      .join('\n'),
    actor.tag,
    discord,
  ).catch(() => {});
  return { ok: true, goals: saved };
}

function addCatalogMaterial(guildId, actor, name, discord = rest) {
  const material = addMaterial(guildId, name);
  audit({
    guildId,
    actorId: actor.userId,
    action: 'farm.material.add.web',
    targetId: String(material.id),
    detail: material.display_name,
  });
  notifyLog(
    guildId,
    'Material adicionado',
    `**${material.display_name}** entrou no catálogo pelo painel.`,
    actor.tag,
    discord,
  ).catch(() => {});
  return { ok: true, material };
}

function removeCatalogMaterial(guildId, actor, name, discord = rest) {
  const material = deactivateMaterial(guildId, name);
  audit({
    guildId,
    actorId: actor.userId,
    action: 'farm.material.remove.web',
    targetId: String(material.id),
    detail: material.display_name,
  });
  notifyLog(
    guildId,
    'Material removido',
    `**${material.display_name}** foi desativado pelo painel.`,
    actor.tag,
    discord,
  ).catch(() => {});
  return { ok: true, material };
}

function reviewEntry(guildId, actor, entryId, status, discord = rest) {
  if (!['approved', 'rejected'].includes(status)) {
    const error = new Error('Status inválido.');
    error.status = 400;
    throw error;
  }
  const entry = withTransaction(() => {
    const updated = setEntryStatus(guildId, entryId, status, actor.userId);
    audit({
      guildId,
      actorId: actor.userId,
      action: `farm.${status}.web`,
      targetId: String(entryId),
      detail: updated.material,
    });
    return updated;
  });
  notifyLog(
    guildId,
    status === 'approved' ? 'Registro aprovado' : 'Registro rejeitado',
    `ID \`${entry.id}\` de <@${entry.user_id}> (${formatQuantity(entry.quantity)}x ${displayMaterial(entry.material)}).`,
    actor.tag,
    discord,
  ).catch(() => {});
  return { ok: true, entry };
}

function correctEntry(guildId, actor, entryId, fields, discord = rest) {
  const current = getEntry(guildId, entryId);
  if (!current) {
    const error = new Error('Registro não encontrado.');
    error.status = 404;
    throw error;
  }
  const reason = truncate(String(fields.reason || '').trim(), 200);
  if (!reason) {
    const error = new Error('Informe o motivo da correção.');
    error.status = 400;
    throw error;
  }
  let material;
  if (fields.material) {
    const found = getMaterial(guildId, fields.material);
    if (!found) {
      const error = new Error('Material fora do catálogo.');
      error.status = 400;
      throw error;
    }
    material = found.name;
  }
  const updated = withTransaction(() => {
    const row = updateEntry(guildId, entryId, {
      quantity: fields.quantity ?? undefined,
      material,
      note: fields.note === undefined ? undefined : fields.note,
      reviewedBy: actor.userId,
    });
    audit({
      guildId,
      actorId: actor.userId,
      action: 'farm.correct.web',
      targetId: String(entryId),
      detail: reason,
    });
    return row;
  });
  notifyLog(
    guildId,
    'Registro corrigido',
    `ID \`${updated.id}\`: ${formatQuantity(current.quantity)}x ${displayMaterial(current.material)} → ${formatQuantity(updated.quantity)}x ${displayMaterial(updated.material)}.\nMotivo: ${reason}`,
    actor.tag,
    discord,
  ).catch(() => {});
  return { ok: true, entry: updated };
}

function removeEntry(guildId, actor, entryId, reason, discord = rest) {
  const current = getEntry(guildId, entryId);
  if (!current) {
    const error = new Error('Registro não encontrado.');
    error.status = 404;
    throw error;
  }
  const why = truncate(String(reason || '').trim(), 200);
  if (!why) {
    const error = new Error('Informe o motivo da exclusão.');
    error.status = 400;
    throw error;
  }
  withTransaction(() => {
    deleteEntry(guildId, entryId);
    audit({
      guildId,
      actorId: actor.userId,
      action: 'farm.delete.web',
      targetId: String(entryId),
      detail: why,
    });
  });
  notifyLog(
    guildId,
    'Registro apagado',
    `ID \`${current.id}\` de <@${current.user_id}> (${formatQuantity(current.quantity)}x ${displayMaterial(current.material)}).\nMotivo: ${why}`,
    actor.tag,
    discord,
  ).catch(() => {});
  return { ok: true };
}

async function refreshPanel(guildId, actor, discord = rest) {
  const settings = getSettings(guildId);
  if (!settings.farm_channel_id || !settings.farm_panel_message_id) {
    const error = new Error('O painel ainda não foi publicado no Discord.');
    error.status = 400;
    throw error;
  }
  try {
    await discord.editMessage(
      settings.farm_channel_id,
      settings.farm_panel_message_id,
      rest.toRestPayload(farmBoardMessage(guildId)),
    );
  } catch (error) {
    if (error.status === 404) {
      setSetting(guildId, 'farm_panel_message_id', null);
      const gone = new Error('A mensagem do painel não existe mais. Publique de novo.');
      gone.status = 409;
      throw gone;
    }
    throw error;
  }
  audit({
    guildId,
    actorId: actor.userId,
    action: 'farm.panel.refresh.web',
    targetId: settings.farm_panel_message_id,
  });
  return { ok: true };
}

async function publishPanel(guildId, actor, channelId, discord = rest) {
  const target = String(channelId || getSettings(guildId).farm_channel_id || '').trim();
  if (!/^\d{5,32}$/.test(target)) {
    const error = new Error('Informe o ID de um canal de texto válido.');
    error.status = 400;
    throw error;
  }
  const payload = rest.toRestPayload(farmBoardMessage(guildId));
  const settings = getSettings(guildId);
  if (settings.farm_channel_id === target && settings.farm_panel_message_id) {
    try {
      await discord.editMessage(target, settings.farm_panel_message_id, payload);
      audit({
        guildId,
        actorId: actor.userId,
        action: 'farm.panel.publish.web',
        targetId: settings.farm_panel_message_id,
        detail: target,
      });
      return { ok: true, messageId: settings.farm_panel_message_id, channelId: target };
    } catch {
      // post a new one
    }
  }
  const posted = await discord.sendMessage(target, payload);
  setSetting(guildId, 'farm_channel_id', target);
  setSetting(guildId, 'farm_panel_message_id', posted.id);
  audit({
    guildId,
    actorId: actor.userId,
    action: 'farm.panel.publish.web',
    targetId: posted.id,
    detail: target,
  });
  return { ok: true, messageId: posted.id, channelId: target };
}

const WEB_SETTING_KEYS = new Set([
  'log_channel_id',
  'ai_channel_id',
  'admin_channel_id',
  'farm_channel_id',
  'auto_approve',
  'leader_role_id',
  'manager_role_id',
  'member_role_id',
  'identity_name',
  'presence_text',
]);

function updateSettings(guildId, actor, patch) {
  const current = getSettings(guildId);
  const applied = {};
  for (const [key, raw] of Object.entries(patch || {})) {
    if (!WEB_SETTING_KEYS.has(key)) {
      continue;
    }
    if (key === 'auto_approve') {
      applied[key] = raw ? 1 : 0;
      setSetting(guildId, key, applied[key]);
      continue;
    }
    if (key === 'identity_name' || key === 'presence_text') {
      const value = raw == null ? null : truncate(String(raw).trim(), 80) || null;
      applied[key] = value;
      setSetting(guildId, key, value);
      continue;
    }
    const value = raw == null || raw === '' ? null : String(raw).trim();
    if (value && !/^\d{5,32}$/.test(value)) {
      const error = new Error(`ID inválido para ${key}.`);
      error.status = 400;
      throw error;
    }
    applied[key] = value;
    setSetting(guildId, key, value);
  }
  audit({
    guildId,
    actorId: actor.userId,
    action: 'settings.update.web',
    detail: JSON.stringify(applied),
  });
  return { ok: true, settings: publicSettings(getSettings(guildId)), previous: publicSettings(current) };
}

function reloadRules(guildId, actor) {
  const result = reloadKnowledge();
  if (!result.aborted) {
    documents.reindexPublishedGuildDocs(guildId);
  }
  audit({
    guildId,
    actorId: actor.userId,
    action: 'ai.reload.web',
    detail: result.aborted ? 'aborted' : `indexed=${result.indexed}`,
  });
  return result;
}

async function runBackup(guildId, actor) {
  const dest = await backupDatabase();
  audit({
    guildId,
    actorId: actor.userId,
    action: 'db.backup.web',
    detail: dest,
  });
  return { ok: true, path: dest, backups: listBackupFiles().slice(0, 8) };
}

function publicGuildDocument(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    status: row.status,
    publishedVersion: row.published_version || null,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function publicDocumentDetail(payload) {
  return {
    document: publicGuildDocument(payload.document),
    draft: payload.draft
      ? {
          id: payload.draft.id,
          versionNumber: payload.draft.version_number,
          content: payload.draft.content,
          hash: payload.draft.content_hash,
          message: payload.draft.change_message,
          updatedAt: payload.draft.created_at,
        }
      : null,
    published: payload.published
      ? {
          id: payload.published.id,
          versionNumber: payload.published.version_number,
          content: payload.published.content,
          hash: payload.published.content_hash,
          publishedAt: payload.published.published_at,
        }
      : null,
    versions: (payload.versions || []).map((row) => ({
      id: row.id,
      versionNumber: row.version_number,
      status: row.status,
      hash: row.content_hash,
      message: row.change_message,
      createdBy: row.created_by,
      createdAt: row.created_at,
      publishedAt: row.published_at,
    })),
  };
}

function getGuildPage(guildId) {
  const settings = getSettings(guildId);
  return {
    botName: BOT_NAME,
    guild: getGuild(guildId) || {
      id: guildId,
      name: null,
      status: 'unknown',
    },
    settings: publicSettings(settings),
  };
}

async function refreshGuild(guildId, actor, discord = rest) {
  const remote = await discord.fetchGuild(guildId);
  upsertGuild({
    id: remote.id || guildId,
    name: remote.name,
    icon: remote.icon,
    ownerId: remote.owner_id || remote.ownerId,
    memberCount: remote.approximate_member_count || remote.memberCount || null,
  });
  audit({
    guildId,
    actorId: actor.userId,
    action: 'guild.refresh.web',
  });
  return getGuildPage(guildId);
}

function updateGuildIdentity(guildId, actor, patch) {
  return updateSettings(guildId, actor, {
    identity_name: patch.identityName ?? patch.identity_name,
    presence_text: patch.presenceText ?? patch.presence_text,
  });
}

function listGuildDocuments(guildId, { status } = {}) {
  const rows = documents.listDocuments(guildId);
  return {
    documents: rows
      .filter((row) => !status || row.status === status)
      .map(publicGuildDocument),
  };
}

function getGuildDocument(guildId, id) {
  return publicDocumentDetail(documents.getDocument(guildId, id));
}

function createGuildDocument(guildId, actor, payload) {
  return publicDocumentDetail(documents.createDocument(guildId, actor, payload));
}

function updateGuildDocument(guildId, actor, id, payload) {
  return publicDocumentDetail(documents.updateDraft(guildId, id, actor, payload));
}

function listDocumentVersions(guildId, id) {
  return { versions: publicDocumentDetail(documents.getDocument(guildId, id)).versions };
}

function restoreDocumentVersion(guildId, actor, id, versionNumber) {
  return publicDocumentDetail(
    documents.restoreVersion(guildId, id, actor, versionNumber),
  );
}

function validateGuildDocuments(guildId, documentIds) {
  const result = documents.validateDocuments(guildId, documentIds);
  return {
    ok: result.ok,
    rejected: result.rejected,
    accepted: result.accepted.map((item) => publicGuildDocument(item.document)),
  };
}

function publishGuildDocuments(guildId, actor, payload) {
  return documents.publishDocuments(guildId, actor, payload);
}

function listGuildReleases(guildId) {
  return {
    releases: documents.listReleases(guildId).map((row) => ({
      id: row.id,
      releaseNumber: row.release_number,
      status: row.status,
      message: row.message,
      createdBy: row.created_by,
      publishedAt: row.published_at,
    })),
  };
}

function rollbackGuildRelease(guildId, actor, releaseId) {
  return documents.rollbackRelease(guildId, actor, releaseId);
}

function getGuildCatalogs(guildId) {
  return { catalogs: documents.listGuildCatalogs(guildId) };
}

function importGuildCatalog(guildId, actor, kind, items) {
  const validators = {
    prices: validatePrices,
    actions: validateActions,
    partnerships: validatePartnerships,
  };
  const validate = validators[kind];
  if (!validate) {
    const error = new Error('Catálogo desconhecido.');
    error.status = 400;
    throw error;
  }
  const errors = validate(items);
  if (errors.length) {
    const error = new Error(errors[0]);
    error.status = 400;
    error.rejected = errors;
    throw error;
  }
  return documents.importCatalog(guildId, actor, kind, items);
}

function getAiEntitlements(guildId) {
  return getEntitlementState(guildId);
}

function getAiUsage(guildId) {
  return usageSummary(guildId);
}

module.exports = {
  goalsWithProgress,
  publicSettings,
  getDashboard,
  getFarmPage,
  getMembersPage,
  getAuditPage,
  getAiPage,
  diagnoseQuestion,
  getStatus,
  saveGoals,
  addCatalogMaterial,
  removeCatalogMaterial,
  reviewEntry,
  correctEntry,
  removeEntry,
  refreshPanel,
  publishPanel,
  updateSettings,
  reloadRules,
  runBackup,
  getGuildPage,
  refreshGuild,
  updateGuildIdentity,
  listGuildDocuments,
  getGuildDocument,
  createGuildDocument,
  updateGuildDocument,
  listDocumentVersions,
  restoreDocumentVersion,
  validateGuildDocuments,
  publishGuildDocuments,
  listGuildReleases,
  rollbackGuildRelease,
  getGuildCatalogs,
  importGuildCatalog,
  getAiEntitlements,
  getAiUsage,
};
