# Faction Farm Bot

Bot Discord para registrar farm de facção em GTA RP, com metas semanais, cargos de liderança, embeds e assistente de regras.

## Membros

Membros **não usam slash command** de farm. No canal público, a liderança publica uma embed com as metas da semana. O membro:

- escolhe o material no menu para lançar farm
- usa **Ranking** e **Meus registros** (só ele vê a resposta)

## Liderança (`/tdc`)

O comando `/tdc` fica escondido dos membros. Os cargos de **líder (00)**, **gerente** e **membro** vêm do `.env`:

```
ROLE_LEADER_ID=
ROLE_MANAGER_ID=
ROLE_MEMBER_ID=
```

No Discord: clique no cargo com o botão direito → **Copiar ID do cargo** (ative o Modo desenvolvedor). Reinicie o bot depois de preencher.

- `/tdc canal-admin`: define o chat da staff e **trava as permissões** (some para o @everyone; libera 00, gerente e o Coroa)
- `/tdc painel`: cria a embed da administração
- `/tdc canal-farm` e `/tdc publicar`: canal e embed pública da facção
- `/tdc apelido`: muda o apelido de um membro
- `/tdc cargo-lider|cargo-gerente|cargo-membro` (só se o ID ainda não estiver no `.env`)
- `/tdc canal-log` / `/tdc validacao`
- `/tdc material-adicionar` / `/tdc material-remover`
- `/tdc corrigir` / `/tdc apagar`
- `/limparchat`: apaga mensagens recentes do canal (até 500; some da lista dos membros)

No painel da staff: **Definir metas** (os 5 itens de uma vez), **Atualizar painel**, **Relatório** e **Validar**.

A embed pública atualiza sozinha quando alguém lança farm ou a staff muda a meta.

Depois de `/tdc canal-admin`, o resto dos `/tdc` só funciona nesse canal. O cargo do Coroa precisa de **Gerenciar canais**, **Gerenciar mensagens** e **Gerenciar apelidos**, e ficar acima dos cargos da staff.

## Assistente de regras

- `/ajuda canal`: líder define o canal público do chat de IA.
- `/ajuda pergunta`: responde em público no canal de IA (não fica só para você).
- `/ajuda fontes`: lista documentos indexados.
- `/ajuda recarregar`: líder recarrega a pasta `rules/`.
- `/ajuda limpar-historico`: apaga o histórico da IA daquele membro no canal.

No canal definido com `/ajuda canal`, basta enviar uma mensagem. A IA responde em público, em texto normal (sem embed e sem fontes).

É obrigatório ativar **Message Content Intent** no portal do Discord (Bot → Privileged Gateway Intents).

## Painel web (Vercel + Vue)

O visual do painel é um app **Vue.js + Vite** na Vercel. O bot, o SQLite e a API permanecem no Oracle. A Vercel só autentica com Discord e faz proxy server-side.

```
Liderança / dev
  → https://seu-projeto.vercel.app   (Vue)
  → /api/*                           (funções Vercel)
  → Tailscale Funnel HTTPS
  → coroa-web.service (127.0.0.1:8787)
  → SQLite compartilhado com o bot
```

O navegador **não** fala com o Oracle. Token do bot, chave da OpenRouter e o banco não vão para a Vercel.

### No Oracle

1. Preencha no `.env`: `WEB_API_SECRET`, `SESSION_SECRET`, `WEB_DEV_USER_IDS` (seu ID Discord) e, se quiser, `WEB_ALLOWED_ORIGINS` com a URL `*.vercel.app`.
2. Instale a API:

```
sudo cp deploy/coroa-web.service /etc/systemd/system/coroa-web.service
sudo systemctl daemon-reload
sudo systemctl enable --now coroa-web
curl -sS http://127.0.0.1:8787/healthz
```

3. Exponha só via Tailscale Funnel (sem domínio comprado):

```
chmod +x deploy/tailscale-funnel.sh
./deploy/tailscale-funnel.sh
```

A URL `https://….ts.net` vira `WEB_API_BASE_URL` na Vercel.

4. Para listar membros e registrar entradas/saídas: ative **Server Members Intent**, `DISCORD_MEMBERS_INTENT=true`, e dê **Ver o registro de auditoria** ao cargo do Coroa. Depois `sudo systemctl restart coroa`.

### Na Vercel

1. Crie o projeto apontando para este repositório (root do repo).
2. Build: `npm run build --prefix web` · output: `web/dist`.
3. Variáveis:
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET` (OAuth2 do portal Discord, redirect `https://seu-projeto.vercel.app/api/auth/callback`)
   - `SESSION_SECRET` (o mesmo do Oracle)
   - `WEB_API_SECRET` (o mesmo do Oracle)
   - `WEB_API_BASE_URL` (URL HTTPS do Funnel, sem barra no final)
   - `PUBLIC_BASE_URL` (`https://seu-projeto.vercel.app`)
4. No portal Discord → OAuth2 → Redirects, cadastre o callback acima. Escopo usado: `identify`.

Health check: `systemctl is-active coroa-web` e `journalctl -u coroa-web -n 50 --no-pager`.

Rollback do painel: reverta o código Vue/API, `npm test`, `sudo systemctl restart coroa-web`. O bot Discord continua no ar se a Vercel cair.

Os comandos `/tdc` e `/ajuda` continuam valendo como fallback.

## Configuração

1. Copie `.env.example` para `.env`.
2. Preencha o token do bot, o ID da aplicação, o ID do servidor e `AI_API_KEY` da OpenRouter. Se quiser reserva, use `AI_API_KEYS`.
3. No portal do Discord, ative **Server Members Intent** se quiser o relatório de quem não farmou, e defina `DISCORD_MEMBERS_INTENT=true`.
4. Instale as dependências com `npm install`.
5. Coloque as regras oficiais em `rules/` (`*.md` ou `.txt`). O `README.md` da pasta é ignorado.
6. Instale o serviço para o Coroa ficar sempre ligado (sobe no boot e religa se cair):

```
sudo cp deploy/coroa.service /etc/systemd/system/coroa.service
sudo systemctl daemon-reload
sudo systemctl enable --now coroa
```

Comandos úteis: `sudo systemctl status coroa` · `sudo systemctl restart coroa` · `sudo journalctl -u coroa -f`.

Não use `npm start` em paralelo com o serviço — o bot aceita só uma instância.

O banco é criado automaticamente em `data/farm.sqlite`.

Os dados objetivos usados pela IA ficam nos catálogos:

- `rules/09_precos/catalogo.json`: preços e aliases;
- `rules/06_acoes/catalogo.json`: ações, filtros e contingentes;
- `rules/10_parcerias/catalogo.json`: parcerias, horários e mapas.

Os Markdown de preços e parcerias são gerados a partir desses catálogos durante a recarga. Se algum catálogo estiver inválido, a recarga é recusada e a base anterior é mantida.

Registros entram **aprovados na hora** por padrão. O líder pode mudar isso com `/tdc validacao`.

A IA usa OpenRouter (`deepseek/deepseek-v4-flash-0731` por padrão), busca trechos no SQLite FTS5 e não inventa regra fora das fontes. Opcional: `AI_API_KEYS` com várias chaves (separadas por vírgula) para o Coroa tentar a próxima se uma falhar.

Parcerias (Iraque, Galaxy, Alaska, Seita): os prints dos mapas vão em `assets/parcerias/` (`iraque.png`, `galaxy.png`, `alaska.png`, `hpilegal.png` ou `seita.png`). Depois disso, o Coroa anexa o mapa sozinho.

## Operação

- Health check do bot: `systemctl is-active coroa` e `journalctl -u coroa -n 50 --no-pager`.
- Health check do painel: `systemctl is-active coroa-web`, `curl -sS http://127.0.0.1:8787/healthz` e `journalctl -u coroa-web -n 50 --no-pager`.
- Backup: no boot o Coroa copia o SQLite para `data/backups/` (guarda os 7 mais recentes, configurável com `BACKUP_KEEP`). A liderança também pode gerar backup pelo painel.
- Restore:
  1. `sudo systemctl stop coroa coroa-web`
  2. `cp data/backups/farm-AAAA-MM-DDTHH-MM-SS.sqlite data/farm.sqlite`
  3. `sudo systemctl start coroa coroa-web`
- Rollback de código: volte os arquivos, rode `npm test` e `sudo systemctl restart coroa coroa-web`.
- Não rode `npm start` em paralelo com o serviço.

`/ajuda diagnostico` (só liderança) mostra intenção, caminho, motivo da recusa e trechos encontrados. O mesmo diagnóstico existe no painel web.
