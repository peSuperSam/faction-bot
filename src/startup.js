function validateStartupEnv() {
  const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID'];
  const missing = required.filter((name) => !String(process.env[name] || '').trim());
  const warnings = [];
  if (!String(process.env.AI_API_KEY || process.env.AI_API_KEYS || '').trim()) {
    warnings.push('AI_API_KEY vazia: o chat de regras não vai responder até configurar a OpenRouter.');
  }
  if (process.env.DISCORD_MESSAGE_CONTENT_INTENT !== 'true') {
    warnings.push(
      'DISCORD_MESSAGE_CONTENT_INTENT não está true: o canal da IA precisa dessa intent no portal do Discord.',
    );
  }
  if (!String(process.env.ROLE_LEADER_ID || '').trim()) {
    warnings.push('ROLE_LEADER_ID vazio: só administradores do servidor contam como líder.');
  }
  if (!String(process.env.ROLE_MANAGER_ID || '').trim()) {
    warnings.push('ROLE_MANAGER_ID vazio: gerentes só existem se um admin definir o cargo no Discord.');
  }
  if (process.env.DISCORD_MEMBERS_INTENT !== 'true') {
    warnings.push(
      'DISCORD_MEMBERS_INTENT não está true: o painel não lista membros nem registra entradas/saídas.',
    );
  }
  return {
    ok: missing.length === 0,
    missing,
    warnings,
  };
}

module.exports = {
  validateStartupEnv,
};
