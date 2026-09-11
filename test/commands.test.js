const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.chdir(require('node:path').resolve(__dirname, '..'));

const { PermissionFlagsBits } = require('discord.js');
const { commandJson, handleInteraction, handleAiChannelMessage } = require('../src/commands');
const { reloadKnowledge } = require('../src/knowledge');
const { ephemeral } = require('../src/embeds');

function adminMember() {
  return {
    permissions: {
      has: (flag) =>
        flag === PermissionFlagsBits.Administrator ||
        flag === PermissionFlagsBits.ManageGuild,
    },
    roles: { cache: { has: () => false } },
  };
}

function mockInteraction({
  commandName = 'ajuda',
  subcommand = 'fontes',
  question = 'RDM',
  guildId = `g-${Date.now()}`,
} = {}) {
  const interaction = {
    guildId,
    channelId: 'c1',
    user: { id: 'u1', tag: 'u#1' },
    member: adminMember(),
    deferred: false,
    replied: false,
    lastReply: null,
    isAutocomplete: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => true,
    commandName,
    options: {
      getSubcommand: () => subcommand,
      getString: () => question,
      getChannel: () => null,
    },
    async reply(payload) {
      interaction.replied = true;
      interaction.lastReply = payload;
      return payload;
    },
    async deferReply() {
      interaction.deferred = true;
    },
    async editReply(payload) {
      interaction.lastReply = payload;
      return payload;
    },
  };
  return interaction;
}

describe('comandos Discord (isolados)', () => {
  it('exporta os três slash commands', () => {
    const json = commandJson();
    assert.deepEqual(
      json.map((item) => item.name).sort(),
      ['ajuda', 'limparchat', 'tdc'],
    );
  });

  it('responde /ajuda fontes', async () => {
    reloadKnowledge();
    const interaction = mockInteraction({ subcommand: 'fontes' });
    await handleInteraction(interaction);
    assert.equal(interaction.replied, true);
    assert.ok(interaction.lastReply.embeds?.length);
  });

  it('responde /ajuda diagnostico para liderança', async () => {
    const interaction = mockInteraction({
      subcommand: 'diagnostico',
      question: 'Quanto é lockpick com parceria?',
    });
    await handleInteraction(interaction);
    const body = interaction.lastReply.embeds?.[0]?.data?.description || '';
    assert.match(body, /ficha:price|Caminho/);
  });

  it('ignora interação expirada', async () => {
    const interaction = mockInteraction({ subcommand: 'fontes' });
    interaction.reply = async () => {
      const error = new Error('expired');
      error.code = 10062;
      throw error;
    };
    await handleInteraction(interaction);
  });

  it('responde mensagem no canal de IA', async () => {
    const { setSetting } = require('../src/db');
    const { setCompleteImpl } = require('../src/ai-llm');
    setCompleteImpl(async () => 'sou o Coroa');
    const guildId = `g-ai-${Date.now()}`;
    setSetting(guildId, 'ai_channel_id', 'ai-chan');
    const replies = [];
    await handleAiChannelMessage({
      guild: { id: guildId },
      guildId,
      author: { id: 'u1', bot: false },
      channelId: 'ai-chan',
      content: 'oi',
      client: { user: { id: 'bot' } },
      channel: {
        sendTyping: async () => {},
        send: async (payload) => {
          replies.push(payload);
          return payload;
        },
      },
      reply: async (payload) => {
        replies.push(payload);
        return payload;
      },
    });
    setCompleteImpl(null);
    assert.ok(replies.length > 0);
  });

  it('usa payload ephemeral nas respostas privadas', () => {
    const payload = ephemeral({ content: 'x' });
    assert.ok(payload.flags);
  });
});
