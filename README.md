# Esteira Autônoma de Ofertas — Shopee Afiliados → Telegram + WhatsApp

> **Duas versões neste repositório**
> - **Esta pasta (raiz):** a esteira de uso próprio, com um único usuário (n8n + Evolution + painel). Este README descreve essa versão.
> - **[platform/](platform/):** o **SaaS multi-tenant** (site de vendas, cadastro de clientes, painel por cliente, admin e worker). Veja [platform/README.md](platform/README.md).

```
Schedule (30 min) ─┐
Teste Manual ──────┴─► Config (painel) ─► Assinar productOfferV2 ─► Shopee (HTTP) ─► Filtrar Ofertas
                                                                                  │
   ┌──────────────────────────────────────────────────────────────────────────────┘
   └─► Assinar generateShortLink ─► Shopee (HTTP) ─► Formatar Copy ─┬─► Telegram sendPhoto
                                                                    └─► Evolution sendMedia (WhatsApp)
```

| Arquivo | Conteúdo |
|---|---|
| `docker-compose.yml` | n8n, Evolution API v2.3.7, PostgreSQL 15, Redis 7, painel (bridge `automation`) |
| `dashboard/` | Painel: observabilidade + configurações/credenciais (backend Node + frontend estático) |
| `.env.example` | Apenas segredos de infraestrutura (credenciais de serviço vão no painel) |
| `n8n/code-nodes/*.js` | Código de cada Code Node (fonte única) |
| `n8n/workflow-shopee-afiliados.json` | Workflow pronto para importar |
| `scripts/build-workflow.js` | Regera o JSON após editar os `.js` (`node scripts/build-workflow.js`) |

## 1. Subir a infraestrutura

```bash
cp .env.example .env        # preencha só os segredos de infraestrutura (veja abaixo)
docker compose up -d --build
docker compose ps
docker logs obs-dashboard   # mostra o código de configuração inicial do painel
```

O `.env` precisa apenas de: `N8N_ENCRYPTION_KEY`, `EVOLUTION_API_KEY`, `POSTGRES_PASSWORD` e `DASHBOARD_INGEST_TOKEN` (gere cada um com `openssl rand -hex 32`). **Credenciais da Shopee, do Telegram e do WhatsApp não vão no `.env`**: são cadastradas no painel (seção 3).

- Painel (observabilidade + configurações): http://localhost:3100
- n8n: http://localhost:5678
- Evolution API: http://localhost:8080 (Manager web: http://localhost:8080/manager)

Dentro da rede Docker, o n8n acessa a Evolution por `http://evolution-api:8080`.

> **Porta já em uso?** (`Bind for 0.0.0.0:8080 failed: port is already allocated`) Mude `N8N_HOST_PORT`, `EVOLUTION_HOST_PORT` ou `DASHBOARD_HOST_PORT` no `.env`. Ao mudar a da Evolution, ajuste também `EVOLUTION_SERVER_URL`, e use a nova porta nos comandos `curl` abaixo. A comunicação interna entre containers não muda.

## 2. Evolution API — criar instância e conectar via QR Code

```bash
export EVO=http://localhost:8080
export APIKEY="valor-de-EVOLUTION_API_KEY"
export INSTANCE=shopee
```

**Criar a instância (já retorna o QR Code em base64):**
```bash
curl -X POST "$EVO/instance/create" \
  -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{"instanceName":"'"$INSTANCE"'","integration":"WHATSAPP-BAILEYS","qrcode":true}'
```

**Gerar/renovar o QR Code:**
```bash
curl -s "$EVO/instance/connect/$INSTANCE" -H "apikey: $APIKEY"
```
A resposta traz `base64` (`data:image/png;base64,...`) — cole no navegador para ver a imagem — e `pairingCode`. No celular: **WhatsApp → Aparelhos conectados → Conectar aparelho**. Alternativa mais prática: escanear pelo Manager em `http://localhost:8080/manager`.

Para salvar o QR como PNG:
```bash
curl -s "$EVO/instance/connect/$INSTANCE" -H "apikey: $APIKEY" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const b=JSON.parse(d).base64.split(',')[1];require('fs').writeFileSync('qrcode.png',Buffer.from(b,'base64'));console.log('qrcode.png salvo')})"
```

**Conferir conexão** (esperado: `"state": "open"`):
```bash
curl -s "$EVO/instance/connectionState/$INSTANCE" -H "apikey: $APIKEY"
```

**Descobrir o JID do grupo** (`...@g.us`) — mais fácil pelo botão **Buscar grupos** no painel (Configurações → WhatsApp); via API:
```bash
curl -s "$EVO/group/fetchAllGroups/$INSTANCE?getParticipants=false" -H "apikey: $APIKEY"
```

**Teste manual de envio:**
```bash
curl -X POST "$EVO/message/sendMedia/$INSTANCE" \
  -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{"number":"120363XXXXXXXXXXXX@g.us","mediatype":"image","mimetype":"image/jpeg","media":"https://picsum.photos/600","fileName":"teste.jpg","caption":"*Teste* da esteira ✅"}'
```

> **QR Code não aparece (`{"count":0}`)?** A versão do WhatsApp Web é detectada automaticamente; se mesmo assim falhar, defina `WA_WEB_VERSION` no `.env` com a versão atual do WhatsApp Web e rode `docker compose up -d evolution-api`.

## 3. Configurar credenciais no painel

1. Abra http://localhost:3100. No primeiro acesso, informe o **código de configuração** exibido em `docker logs obs-dashboard` e crie seu usuário e senha de administrador (mínimo 10 caracteres).
2. Vá em **Configurações** e preencha:
   - **Shopee:** App ID e Secret.
   - **Telegram:** token do bot e chat ID (`-100…` ou `@canal`). Em canais, o bot precisa ser administrador.
   - **WhatsApp:** nome da instância e grupo de destino. Use **Buscar grupos** para escolher da lista.
   - **Busca e publicação:** palavras-chave, ordenação, comissão mínima, avaliação mínima, ofertas por execução etc.
3. Use **Testar conexão** em cada bloco. O teste usa o que está digitado, mesmo antes de salvar.
4. Clique em **Salvar alterações**. O cartão no topo mostra **Pronto para publicar** quando tudo estiver ok.

Os interruptores **Publicar no Telegram / WhatsApp** ligam e desligam cada canal sem mexer no workflow. Alterações valem a partir da próxima execução, sem reiniciar nada.

**Como as credenciais são protegidas**
- Segredos (Shopee Secret, token do Telegram) são criptografados com **AES-256-GCM** antes de ir para o banco, vinculados ao nome do campo.
- A chave mestra é gerada automaticamente em `/data/master.key`, no volume `dashboard_data`, **separada do banco**. Para fornecer a sua, use `CONFIG_MASTER_KEY` (64 caracteres hex) no `.env`.
- O navegador nunca recebe um segredo de volta, apenas `•••• 1a2b`. Deixar um campo de segredo vazio mantém o valor atual.
- O painel exige login: senha com scrypt, cookie de sessão `HttpOnly` + `SameSite=Strict` válido por 7 dias, bloqueio de 15 min após 5 tentativas erradas e proteção contra CSRF.
- O n8n lê a configuração em `GET /api/internal/config`, autenticado pelo `DASHBOARD_INGEST_TOKEN`. Nenhuma credencial fica salva no workflow.

> **Backup:** guarde juntos o volume `dashboard_data` (chave) e o banco `observability`. Sem a chave, os segredos não podem ser lidos e precisam ser cadastrados de novo.
>
> **Esqueceu a senha?** Rode `docker exec obs-dashboard node server.js --reset-admin`, veja o novo código com `docker logs obs-dashboard` e crie a conta de novo. As configurações são mantidas.
>
> **Migrando de um `.env` antigo?** As variáveis `SHOPEE_*`, `TELEGRAM_*`, `EVOLUTION_INSTANCE` e `WHATSAPP_GROUP_JID` ainda funcionam como fallback (o painel marca "Vindo do .env"). Salve os valores pelo painel e depois apague essas linhas do `.env`.

O que **continua no `.env`**: segredos de infraestrutura que os containers precisam para iniciar, como as senhas do Postgres, `N8N_ENCRYPTION_KEY`, `DASHBOARD_INGEST_TOKEN` e `EVOLUTION_API_KEY`. Esta última é a chave global com que o próprio servidor Evolution sobe, então não pode ser trocada pelo painel. Ela aparece lá apenas para consulta.

## 4. Importar o workflow no n8n

1. Abra o n8n → crie a conta owner.
2. **Workflows → Create → menu `...` → Import from File** → `n8n/workflow-shopee-afiliados.json` (ou copie o conteúdo e cole com Ctrl+V no canvas).
3. Clique em **Test workflow** (dispara pelo "Teste Manual").
4. Ative o workflow (toggle **Active**) para rodar a cada 30 min.

Não há nada para editar no workflow: o nó **Config** é uma requisição ao painel que traz credenciais e parâmetros a cada execução. Os nós **Telegram ativo?** e **WhatsApp ativo?** respeitam os interruptores das Configurações.

## 5. Como a assinatura Shopee funciona

```
Payload   = JSON.stringify({ query })           // exatamente o body enviado
Signature = sha256_hex(AppID + Timestamp + Payload + Secret)
Header    = Authorization: SHA256 Credential={AppID}, Timestamp={Timestamp}, Signature={Signature}
```

O Code Node entrega o body **já serializado** e o HTTP Request envia em modo **Raw** (`contentType: raw`). Se o body fosse um objeto JSON, o n8n o re-serializaria e a assinatura deixaria de bater (erro `10020 Invalid Signature`). Pela mesma razão, o relógio do host precisa estar sincronizado (o timestamp é validado).

## 6. Comportamento e robustez

- **Deduplicação** e rodízio de página/palavra-chave usam `$getWorkflowStaticData('global')`, que **só persiste em execuções de produção** (workflow ativo). Em testes manuais, os itens podem se repetir.
- Falha no `generateShortLink` de um produto: ele é pulado e os demais seguem.
- Telegram e WhatsApp têm `On Error: Continue`: a queda de um canal não bloqueia o outro.
- Envio WhatsApp com intervalo de 8 s entre mensagens (batching) para reduzir risco de bloqueio; Telegram com 3 s.
- Shopee HTTP: 3 tentativas com 3 s de espera.
- Legenda do Telegram usa Markdown legado com escape de `_ * \` [` e é cortada em 1024 caracteres (limite do `sendPhoto`).

## 7. Painel de observabilidade — http://localhost:3100

Serviço `dashboard` (Node 22 + `pg`, sem dependências de frontend). Cria sozinho o banco `observability` no mesmo PostgreSQL.

| Área | O que mostra | Fonte |
|---|---|---|
| Saúde dos serviços | n8n, API Shopee, WhatsApp (estado da instância), bot do Telegram, PostgreSQL, Redis | Verificações ao vivo (cache de 15 s; Telegram 60 s) |
| Resultados do período | Ofertas publicadas (vs período anterior), comissão potencial, taxa de entrega, execuções, produtos analisados | Eventos do n8n |
| Envios por hora/dia | Linha por canal com crosshair e tooltip; alternável para tabela | Eventos do n8n |
| Taxa de entrega por canal | Medidor com status (≥95% saudável, ≥80% atenção, abaixo disso crítico) | Eventos do n8n |
| Palavras-chave | Ranking de ofertas publicadas por palavra-chave | Eventos do n8n |
| Últimas ofertas / Erros | 12 últimas ofertas com status por canal; falhas de envio e erros da Shopee | Eventos do n8n |
| Execuções do n8n | Últimas 20 execuções (status, modo, duração) | API pública do n8n (opcional) |

Filtro de período (24 h / 7 d / 30 d), atualização automática a cada 30 s, tema claro/escuro.

**Como os dados chegam:** o workflow tem 4 nós `Obs - *` que fazem `POST /api/ingest` com o header `x-ingest-token`:
- `Obs - Resumo da Busca` → `Obs - Registrar Busca`: palavra-chave, página, produtos encontrados e erro da Shopee (registrado mesmo quando a busca falha).
- `Obs - Normalizar Entregas` → `Obs - Registrar Entregas`: sucesso/erro de cada oferta em cada canal.

Todos usam *On Error: Continue*: se o painel estiver fora do ar, a esteira continua publicando normalmente.

**Configuração (`.env`):**
- `DASHBOARD_INGEST_TOKEN` — obrigatório. É o token interno n8n ↔ painel, usado nos eventos e na leitura da configuração. O compose repassa para os dois.
- `N8N_API_KEY` (+ `N8N_WORKFLOW_ID`) — opcional, habilita a tabela de execuções. Crie em n8n → Settings → n8n API e rode `docker compose up -d dashboard`.
- `COOKIE_SECURE=true` — use quando o painel for publicado atrás de HTTPS.

O acesso ao painel é protegido por login (seção 3).

Se você já tinha importado uma versão anterior do workflow, **importe o JSON novamente**. A versão atual lê as credenciais do painel e tem os interruptores de canal.

## 8. Troubleshooting

| Sintoma | Causa provável |
|---|---|
| `Cannot find module 'crypto'` / `require is not defined` | `NODE_FUNCTION_ALLOW_BUILTIN=crypto` ausente — recrie o container n8n |
| `access to env vars denied` | `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` ausente |
| Shopee `10020 Invalid Signature` | AppID/Secret errados, body alterado (não use modo JSON) ou relógio dessincronizado |
| Shopee retorna outro `errors[].extensions.code` | A mensagem aparece no erro do nó "Filtrar Ofertas"; confira permissões da conta na Open API e limites de requisição |
| Telegram `can't parse entities` | Caractere especial fora do escape; troque `parse_mode` para `HTML` se necessário |
| Telegram `chat not found` | Bot não adicionado/admin no canal, ou `TELEGRAM_CHAT_ID` incorreto |
| Evolution `401` | Header `apikey` diferente de `EVOLUTION_API_KEY` |
| Evolution `400 exists: false` | JID do grupo incorreto ou instância desconectada |
| Painel vazio, mas a esteira publica | `DASHBOARD_INGEST_TOKEN` vazio/diferente — veja a saída dos nós `Obs - Registrar *` (HTTP 401) |
| Card "API Shopee" em Atenção | Nenhuma busca há mais de `SHOPEE_STALE_MINUTES` — workflow desativado? |
| Nó "Config" falha com 401 | `DASHBOARD_INGEST_TOKEN` diferente entre n8n e painel — confira o `.env` e rode `docker compose up -d` |
| Erro "Shopee App ID / Secret não configurados" | Preencha em Configurações → Shopee e salve |
| Campo com "Não foi possível descriptografar" | A chave mestra mudou (volume `dashboard_data` recriado ou `CONFIG_MASTER_KEY` alterada) — cadastre o segredo novamente |
| Painel pede um código no primeiro acesso | É esperado: `docker logs obs-dashboard` mostra o código de configuração |
