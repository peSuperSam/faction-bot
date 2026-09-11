const { errorEmbed, ephemeral } = require('./embeds');
const { userFacingAiError } = require('./ai-llm');

function publicErrorMessage(error) {
  if (
    error?.code === 'AI_COOLDOWN' ||
    error?.code === 'AI_BUSY' ||
    error?.code === 'AI_TIMEOUT' ||
    error?.code === 'AI_UNAVAILABLE' ||
    error?.code === 'AI_TOO_LONG' ||
    error?.status === 401 ||
    error?.status === 402 ||
    error?.status === 403 ||
    error?.status === 404 ||
    error?.status === 429
  ) {
    return userFacingAiError(error);
  }
  return 'Não foi possível processar o comando agora.';
}

async function replyError(interaction, message) {
  const payload = ephemeral({ embeds: [errorEmbed(message)] });
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return;
  }
  await interaction.reply(payload);
}

function isExpiredInteraction(error) {
  return error?.code === 10062 || error?.code === 40060;
}

module.exports = {
  publicErrorMessage,
  replyError,
  isExpiredInteraction,
};
