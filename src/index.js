require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Events,
} = require('discord.js');
const { db, databasePath, backupDatabase, pruneAiLogs, pruneMemberEvents, pruneAuditEvents, touchHeartbeat } = require('./db');
const { reloadKnowledge } = require('./knowledge');
const { handleInteraction, handleAiChannelMessage } = require('./commands');
const { validateStartupEnv } = require('./startup');
const { pruneExpiredContext } = require('./user-context');
const { registerMemberEventListeners } = require('./member-events');
const { initializeGuild, deactivateGuild, registerGlobalCommands } = require('./guild-lifecycle');
const { BOT_NAME } = require('./brand');

const lockPath = path.join(__dirname, '..', 'data', 'bot.lock');

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireInstanceLock() {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      const release = () => {
        try {
          const current = Number(String(fs.readFileSync(lockPath, 'utf8')).trim());
          if (current === process.pid) {
            fs.unlinkSync(lockPath);
          }
        } catch {
          // lock already gone
        }
      };
      process.on('exit', release);
      return release;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      const oldPid = Number(String(fs.readFileSync(lockPath, 'utf8')).trim());
      if (pidIsAlive(oldPid) && oldPid !== process.pid) {
        console.error(
          `Outra instância do bot já está rodando (pid ${oldPid}). Encerre-a antes de iniciar outra.`,
        );
        process.exit(1);
      }
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // raced with another start
      }
    }
  }
  console.error('Não foi possível obter o lock da instância do bot.');
  process.exit(1);
}

const releaseInstanceLock = acquireInstanceLock();

const startup = validateStartupEnv();
if (!startup.ok) {
  throw new Error(`Variável obrigatória ausente: ${startup.missing.join(', ')}`);
}
for (const warning of startup.warnings) {
  console.warn(warning);
}

const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
if (process.env.DISCORD_MEMBERS_INTENT === 'true') {
  intents.push(
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration || GatewayIntentBits.GuildBans,
  );
}
if (process.env.DISCORD_MESSAGE_CONTENT_INTENT === 'true') {
  intents.push(GatewayIntentBits.MessageContent);
}

function chmodQuiet(target, mode) {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // ignore if not owner
  }
}

function hardenLocalFiles() {
  const dataDir = path.join(__dirname, '..', 'data');
  const contextDir = path.resolve(
    process.env.AI_CONTEXT_PATH || './data/ai-context',
  );
  chmodQuiet(path.resolve('.env'), 0o600);
  chmodQuiet(databasePath, 0o600);
  chmodQuiet(`${databasePath}-wal`, 0o600);
  chmodQuiet(`${databasePath}-shm`, 0o600);
  chmodQuiet(dataDir, 0o700);
  chmodQuiet(contextDir, 0o700);
}

hardenLocalFiles();

const client = new Client({
  intents,
  allowedMentions: { parse: [] },
});

if (process.env.DISCORD_MEMBERS_INTENT === 'true') {
  registerMemberEventListeners(client);
}

client.once(Events.ClientReady, async (readyClient) => {
  try {
    const indexed = reloadKnowledge();
    touchHeartbeat(`ready docs=${indexed.indexed}`);
    setInterval(() => {
      try {
        touchHeartbeat('alive');
      } catch (error) {
        console.warn('Falha no heartbeat:', error.message);
      }
    }, 30_000).unref();
    try {
      const backupPath = await backupDatabase();
      console.log(`Backup SQLite: ${backupPath}`);
    } catch (error) {
      console.warn('Falha ao criar backup do banco:', error.message);
    }
    try {
      const prunedLogs = pruneAiLogs({ days: Number(process.env.AI_LOG_DAYS || 30) });
      const prunedMembers = pruneMemberEvents({
        days: Number(process.env.MEMBER_EVENT_DAYS || 90),
      });
      const prunedAudit = pruneAuditEvents({
        days: Number(process.env.AUDIT_LOG_DAYS || 90),
      });
      const prunedContext = pruneExpiredContext();
      if (prunedLogs || prunedContext || prunedMembers || prunedAudit) {
        console.log(
          `Retenção: ${prunedLogs} log(s) de IA, ${prunedMembers} evento(s) de membro, ${prunedAudit} auditoria(s) e ${prunedContext} contexto(s) removidos.`,
        );
      }
    } catch (error) {
      console.warn('Falha na limpeza de logs/contexto:', error.message);
    }
    try {
      await registerGlobalCommands();
    } catch (error) {
      console.warn('Falha ao registrar comandos globais:', error.message);
    }
    for (const guild of readyClient.guilds.cache.values()) {
      try {
        const settings = await initializeGuild(readyClient, guild);
        console.log(
          `[${guild.name}] cargos líder=${settings.leader_role_id || '—'} gerente=${settings.manager_role_id || '—'} membro=${settings.member_role_id || '—'}`,
        );
      } catch (error) {
        console.warn(`Falha ao inicializar a guilda ${guild.id}:`, error.message);
      }
    }

    console.log(`${BOT_NAME} conectado como ${readyClient.user.tag}`);
    console.log(`Banco SQLite: ${databasePath}`);
    console.log(
      `Regras globais indexadas: ${indexed.indexed} documento(s), ${indexed.rejected.length} recusado(s).`,
    );
    console.log(`Guildas ativas: ${readyClient.guilds.cache.size}`);
  } catch (error) {
    console.error('Falha na inicialização do bot:', error);
    try {
      db.close();
    } catch {
      // ignore
    }
    try {
      readyClient.destroy();
    } catch {
      // ignore
    }
    releaseInstanceLock();
    process.exit(1);
  }
});

client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.MessageCreate, handleAiChannelMessage);
client.on(Events.GuildCreate, (guild) => {
  initializeGuild(client, guild).catch((error) => {
    console.warn(`Falha no onboarding da guilda ${guild.id}:`, error.message);
  });
});
client.on(Events.GuildDelete, (guild) => {
  try {
    deactivateGuild(guild.id);
  } catch (error) {
    console.warn(`Falha ao marcar guilda inativa ${guild.id}:`, error.message);
  }
});
client.on(Events.Error, (error) => {
  console.error('Erro do cliente Discord:', error);
});

function shutdown(code) {
  try {
    db.close();
  } catch {
    // ignore
  }
  try {
    client.destroy();
  } catch {
    // ignore
  }
  releaseInstanceLock();
  process.exit(code);
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('uncaughtException', (error) => {
  console.error('uncaughtException:', error);
  shutdown(1);
});
process.on('unhandledRejection', (error) => {
  console.error('unhandledRejection:', error);
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('Falha ao autenticar no Discord:', error);
  shutdown(1);
});
