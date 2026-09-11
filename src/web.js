require('dotenv').config();

const { validateStartupEnv } = require('./startup');
const { startWebApi } = require('./web-api');

const startup = validateStartupEnv();
if (!startup.ok) {
  throw new Error(`Variável obrigatória ausente: ${startup.missing.join(', ')}`);
}
if (!String(process.env.WEB_API_SECRET || '').trim()) {
  throw new Error('WEB_API_SECRET ausente: a API web não inicia sem o segredo de serviço.');
}

startWebApi();
