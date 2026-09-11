const { PermissionFlagsBits } = require('discord.js');
const { getSettings } = require('./db');

const ADMIN = BigInt(PermissionFlagsBits.Administrator);
const MANAGE_GUILD = BigInt(PermissionFlagsBits.ManageGuild);

function developerIds() {
  return String(process.env.WEB_DEV_USER_IDS || '')
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function isDeveloper(userId) {
  return developerIds().includes(String(userId || ''));
}

function memberRoleIds(member) {
  if (!member) {
    return [];
  }
  if (Array.isArray(member.roles)) {
    return member.roles.map(String);
  }
  if (member.roles?.cache?.has) {
    return [...member.roles.cache.keys()].map(String);
  }
  return [];
}

function permissionBits(member, roles = []) {
  if (typeof member?.permissions?.has === 'function') {
    let bits = 0n;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      bits |= ADMIN;
    }
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      bits |= MANAGE_GUILD;
    }
    return bits;
  }
  if (member?.permissions != null && member.permissions !== '') {
    try {
      return BigInt(member.permissions);
    } catch {
      // ignore
    }
  }
  const ids = new Set(memberRoleIds(member));
  let bits = 0n;
  for (const role of roles) {
    if (!ids.has(String(role.id))) {
      continue;
    }
    try {
      bits |= BigInt(role.permissions || 0);
    } catch {
      // ignore
    }
  }
  return bits;
}

function isGuildAdminMember(member, roles = [], guild = null) {
  if (!member) {
    return false;
  }
  const userId = String(member.user?.id || member.id || '');
  if (guild?.owner_id && String(guild.owner_id) === userId) {
    return true;
  }
  const bits = permissionBits(member, roles);
  return (bits & ADMIN) === ADMIN || (bits & MANAGE_GUILD) === MANAGE_GUILD;
}

function hasConfiguredRole(member, roleId) {
  return Boolean(roleId) && memberRoleIds(member).includes(String(roleId));
}

function resolveAccess({ userId, member = null, roles = [], guild = null, settings = null }) {
  const guildId = settings?.guild_id || guild?.id || process.env.DISCORD_GUILD_ID;
  const resolvedSettings = settings || getSettings(guildId);
  const developer = isDeveloper(userId);
  const leader =
    developer ||
    isGuildAdminMember(member, roles, guild) ||
    hasConfiguredRole(member, resolvedSettings.leader_role_id);
  const manager = leader || hasConfiguredRole(member, resolvedSettings.manager_role_id);
  const memberOk =
    manager ||
    !resolvedSettings.member_role_id ||
    hasConfiguredRole(member, resolvedSettings.member_role_id);
  let role = 'none';
  if (developer) {
    role = 'developer';
  } else if (leader) {
    role = 'leader';
  } else if (manager) {
    role = 'manager';
  } else if (member && memberOk) {
    role = 'member';
  }
  return {
    userId: String(userId),
    role,
    isDeveloper: developer,
    isLeader: leader,
    isManager: manager,
    isMember: Boolean(member) && memberOk,
    inGuild: Boolean(member),
    settings: resolvedSettings,
  };
}

function assertRole(access, minimum) {
  const order = { none: 0, member: 1, manager: 2, leader: 3, developer: 4 };
  const have = order[access.role] || 0;
  const need = order[minimum] || 0;
  if (have < need) {
    const error = new Error('Sem permissão para esta ação.');
    error.status = 403;
    throw error;
  }
}

module.exports = {
  developerIds,
  isDeveloper,
  memberRoleIds,
  resolveAccess,
  assertRole,
};
