const { replyError, publicErrorMessage, isExpiredInteraction } = require('./discord-util');
const {
  tdcCommand,
  clearChatCommand,
  handleAutocomplete,
  handleComponent,
  handleTdcCommand,
  handleClearChat,
} = require('./farm-commands');
const {
  helpCommand,
  handleHelpCommand,
  handleAiChannelMessage,
} = require('./ai-commands');

function commandJson() {
  return [tdcCommand.toJSON(), helpCommand.toJSON(), clearChatCommand.toJSON()];
}

async function handleInteraction(interaction) {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }
    if (
      interaction.isButton() ||
      interaction.isStringSelectMenu() ||
      interaction.isModalSubmit()
    ) {
      await handleComponent(interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) {
      return;
    }
    if (interaction.commandName === 'ajuda') {
      await handleHelpCommand(interaction);
      return;
    }
    if (interaction.commandName === 'tdc') {
      await handleTdcCommand(interaction);
      return;
    }
    if (interaction.commandName === 'limparchat') {
      await handleClearChat(interaction);
    }
  } catch (error) {
    if (isExpiredInteraction(error)) {
      return;
    }
    console.error('Erro ao processar interação:', error);
    if (interaction.isAutocomplete()) {
      try {
        await interaction.respond([]);
      } catch {
        // ignore
      }
      return;
    }
    const message = publicErrorMessage(error);
    try {
      await replyError(interaction, message);
    } catch (replyErrorValue) {
      if (!isExpiredInteraction(replyErrorValue)) {
        console.error('Falha ao responder erro:', replyErrorValue);
      }
    }
  }
}

module.exports = {
  commandJson,
  handleInteraction,
  handleAiChannelMessage,
};
