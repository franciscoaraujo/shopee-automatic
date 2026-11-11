# Prompt — Painel Administrativo do AutoAchados (projeto separado)

> Cole tudo abaixo da linha no assistente de IA do novo projeto.
> **Não cole senhas aqui.** Os valores reais ficam no `.env` do novo projeto (veja a seção 2).

---

Você é um Engenheiro de Software sênior especialista em Next.js, PostgreSQL, segurança de aplicações e painéis administrativos para SaaS.

Sua tarefa é criar, **num projeto novo e independente**, o painel administrativo do AutoAchados: um SaaS multi-tenant que publica ofertas de afiliado da Shopee em grupos de WhatsApp/Telegram de cada cliente. O painel é usado só pelo dono da plataforma e pela equipe dele. Ele lê e altera o **mesmo banco PostgreSQL** da plataforma em produção. Por isso, todas as escritas precisam respeitar as regras da seção 4.

## 1. Stack obrigatória

- Next.js (App Router) + TypeScript + Tailwind; Server Actions para escrita.
- Driver `pg` (node-postgres), SQL parametrizado (`$1, $2…`). Nada de concatenar strings em SQL. Não use ORM que gere migrações sobre tabelas existentes.
- Validação de entrada com Zod no servidor.
- Docker: Dockerfile + `docker-compose.yml` próprio, ligado à rede Docker da plataforma (seção 2).

## 2. Acesso ao banco

| Item | Valor |
|---|---|
| Motor | PostgreSQL 15 |
| Banco | `autoachados` |
| Usuário da plataforma | `autoachados` (**não use no painel**; crie o papel `aa_admin_panel` abaixo) |
| Host dentro do Docker | `postgres`, porta `5432` |
| Rede Docker | `autoachados_default` (externa, criada pelo compose da plataforma) |
| Fuso | `America/Sao_Paulo` (todas as colunas de data são `timestamptz`) |
| Outro banco no mesmo servidor | `evolution` (da Evolution API). **O painel não toca nele.** |

O Postgres **não é publicado na máquina hospedeira**. Formas de acessar:

1. **Produção (recomendado):** o painel roda como container na rede `autoachados_default`.
   ```yaml
   services:
     admin:
       build: .
       env_file: .env
       ports: ["127.0.0.1:3200:3000"]   # exponha via Caddy/VPN, nunca 0.0.0.0 sem proteção
       networks: [autoachados]
   networks:
     autoachados:
       external: true
       name: autoachados_default
   ```
   `DATABASE_URL=postgres://aa_admin_panel:<SENHA>@postgres:5432/autoachados`
2. **Desenvolvimento local:** na pasta da plataforma, crie `docker-compose.override.yml` com
   `services: { postgres: { ports: ["127.0.0.1:5432:5432"] } }` e use
   `DATABASE_URL=postgres://aa_admin_panel:<SENHA>@localhost:5432/autoachados`.
3. **Produção a partir do seu computador:** túnel SSH (`ssh -L 5432:<ip do container postgres>:5432 usuario@vps`). Nunca abra a 5432 na internet.

**Papel de banco com privilégio mínimo.** Rode uma vez como superusuário:
```bash
docker compose exec postgres psql -U autoachados -d autoachados
```
```sql
CREATE ROLE aa_admin_panel LOGIN PASSWORD '<gere com: openssl rand -hex 24>';
GRANT CONNECT ON DATABASE autoachados TO aa_admin_panel;
GRANT USAGE, CREATE ON SCHEMA public TO aa_admin_panel;          -- CREATE: só para as tabelas admin_* (seção 5)
GRANT SELECT ON accounts, users, runs, deliveries, sent_items, email_tokens TO aa_admin_panel;
GRANT SELECT (account_id, key, encrypted, updated_at) ON account_settings TO aa_admin_panel;  -- nunca a coluna value
GRANT UPDATE (name, plan, status, trial_ends_at, notes, next_run_at, whatsapp) ON accounts TO aa_admin_panel;
GRANT UPDATE (password_hash, email_verified_at) ON users TO aa_admin_panel;
GRANT DELETE ON accounts TO aa_admin_panel;
GRANT SELECT, DELETE ON sessions TO aa_admin_panel;
GRANT SELECT, INSERT, UPDATE, DELETE ON plans, promotions, account_overrides TO aa_admin_panel;
GRANT SELECT ON system_kv TO aa_admin_panel;
```
Sem acesso a `account_settings.value`: lá ficam as credenciais dos clientes (Shopee, Telegram), cifradas com AES-256-GCM. O painel **não recebe** o `APP_MASTER_KEY` e nunca exibe nem decifra essas credenciais. Para saber se o cliente configurou algo, basta checar se a chave existe.

**Variáveis do `.env` do painel:**
```
DATABASE_URL=postgres://aa_admin_panel:...@postgres:5432/autoachados
ADMIN_SESSION_SECRET=            # openssl rand -hex 32
EVOLUTION_API_URL=http://evolution:8080
EVOLUTION_API_KEY=               # mesmo valor do .env da plataforma (só para desconectar WhatsApp ao excluir conta)
PLATFORM_URL=https://seudominio.com.br
COOKIE_SECURE=true
```

## 3. Esquema existente (somente as colunas relevantes)

**`accounts`**: um registro por cliente (tenant).

| Coluna | Tipo | Significado |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | nome da conta |
| `plan` | text | id de um plano da tabela `plans` (hoje `start`, `pro`, `escala`) |
| `status` | text | `trial` \| `active` \| `suspended` \| `canceled` |
| `trial_ends_at` | timestamptz | fim do teste grátis |
| `whatsapp`, `source` | text | contato e origem do cadastro |
| `notes` | text | anotações internas (máx. 2000) |
| `next_run_at` | timestamptz | próxima rodada agendada pelo worker |
| `manual_run` | boolean | "rodar agora" pendente |
| `kw_index`, `page` | integer | estado interno do rodízio. **Não alterar.** |
| `created_at` | timestamptz | |

**`users`**: hoje é 1 usuário por conta (o mais antigo é o dono).
`id uuid`, `account_id → accounts ON DELETE CASCADE`, `name`, `email UNIQUE` (minúsculo), `password_hash`, `email_verified_at` (NULL = não confirmou o e-mail e **não consegue entrar**), `last_login_at`, `created_at`.

**`sessions`**: `token_hash PK`, `user_id`, `expires_at`. Apagar as linhas de um usuário o desconecta na hora.

**`account_settings`**: `(account_id, key)` PK, `value`, `encrypted`, `updated_at`. Chaves úteis para status de configuração:
- credenciais: `shopeeAppId`, `shopeeSecret`
- canais: `whatsappEnabled`, `whatsappGroupJid`, `telegramEnabled`, `telegramBotToken`, `telegramChatId`
- busca e agenda: `runIntervalMin`, `maxPostsPerRun`, `scheduleEnabled`, `scheduleStart`, `scheduleEnd`, `scheduleDays`

**`runs`**: rodadas do worker. `id bigserial`, `account_id`, `trigger` (`schedule`/`manual`), `keyword`, `found`, `selected`, `error`, `duration_ms`, `created_at`.

**`deliveries`**: cada envio. `account_id`, `run_id`, `channel` (`whatsapp`/`telegram`), `item_id`, `product_name`, `price`, `commission_rate`, `commission`, `success`, `error`, `created_at`.

**`sent_items`**: deduplicação `(account_id, item_id)`. Somente leitura.

**`email_tokens`**: links de confirmação e recuperação de senha. Somente leitura.

**`system_kv`**: a chave `worker_heartbeat` guarda o último sinal do worker. Mostre um alerta se tiver mais de 2 min.

Toda tabela filha usa `ON DELETE CASCADE` a partir de `accounts`.

## 4. Regras de negócio que o painel PRECISA respeitar

1. **Quem roda:** o worker só processa contas com `status = 'active'` ou `(status = 'trial' AND trial_ends_at > now())`. Isso é "liberar/limitar acesso":
   - **Liberar:** `status = 'active'`.
   - **Suspender** (o cliente entra no painel, mas a esteira para e aparece um aviso): `status = 'suspended'`.
   - **Cancelar:** `status = 'canceled'`.
   - **Bloquear login imediatamente:** além do status, `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE account_id = $1)`.
2. **Ao mudar `plan` ou `status`, sempre grave `next_run_at = NULL`** na mesma query. O worker recalcula o agendamento com os limites novos.
3. **Teste grátis:** durante `trial`, valem os limites do plano **Pro**, qualquer que seja `plan`. Para estender o teste:
   `UPDATE accounts SET status='trial', trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + ($2 || ' days')::interval WHERE id=$1`.
4. **Senha:** formato `scrypt$<salt base64>$<hash base64>`, com N=16384, r=8, p=1, keylen=64, salt de 16 bytes (`crypto.scrypt` do Node). Para resetar:
   - gere uma senha aleatória e mostre-a uma única vez;
   - grave o hash nesse formato;
   - apague as sessões do usuário.
5. **Confirmar e-mail manualmente:** `UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE account_id = $1`.
6. **Excluir conta (LGPD), nesta ordem:**
   1. desconecte o WhatsApp na Evolution API:
      - `DELETE {EVOLUTION_API_URL}/instance/logout/aa_<uuid sem hífens>`
      - depois `DELETE /instance/delete/aa_<uuid sem hífens>`
      - header `apikey: EVOLUTION_API_KEY`, timeout de 15 s, ignore erro
   2. `DELETE FROM accounts WHERE id = $1`. O cascade apaga todo o resto.

   Exija digitar o e-mail da conta para confirmar.
7. **Nunca** altere `kw_index`, `page` ou `manual_run`, nem crie ou altere colunas ou tabelas existentes. Tabelas novas só com prefixo `admin_` ou as da seção 5.
8. Todas as escritas em transação, e **toda ação gera um registro em `admin_audit_log`**.

## 5. Planos, pacotes e promoções (já funcionam na plataforma)

A plataforma **cria e lê** estas tabelas. O painel **não cria nem altera a estrutura** delas, só faz INSERT, UPDATE e DELETE nas linhas. Alterações chegam ao site, ao painel do cliente e ao worker em até **30 s**, porque a plataforma guarda os planos em cache, sem precisar reiniciar nada.

```sql
-- plans: um registro por plano/pacote
id            text PK  CHECK (id ~ '^[a-z0-9_-]{2,30}$')   -- imutável depois de criado
name          text            -- nome exibido
price_cents   integer >= 0    -- preço mensal em centavos (9700 = R$ 97)
tagline       text            -- frase curta no card do site
interval_min  integer 10..240 -- ciclo mínimo entre rodadas (minutos)
max_channels  smallint 1|2    -- 1 = WhatsApp OU Telegram; 2 = os dois
max_per_run   smallint 1..20  -- ofertas por rodada
schedule      jsonb           -- {"mode":"fixed","start":"08:00","end":"16:00","days":"0,1,2,3,4,5,6"}
                              -- {"mode":"bounded","earliest":"06:00","latest":"23:00"}   (earliest < latest)
                              -- {"mode":"full"}
                              -- days: 0=domingo … 6=sábado
items         jsonb           -- array de strings: bullets do card (máx. 12)
highlight     boolean         -- destaque "Mais escolhido"
visible       boolean         -- false = sai do site/cadastro, mas quem já tem continua funcionando
sort_order    integer         -- ordem no site
updated_at    timestamptz

-- promotions
id               uuid PK
code             text UNIQUE NULL  CHECK (code ~ '^[A-Z0-9_-]{3,30}$')  -- NULL = automática; com código = cupom
description      text              -- aparece no site e na conta do cliente
plan_ids         text[]            -- planos em que vale
discount_type    'percent' | 'fixed' | 'extra_trial_days'
discount_value   integer > 0       -- % (≤100) | centavos | dias
starts_at, ends_at timestamptz     -- ends_at NULL = sem fim
max_redemptions  integer NULL      -- NULL = ilimitado
redemptions      integer           -- incrementado pela plataforma. NÃO edite
active           boolean           -- false = encerra e também tira o desconto de quem já tinha
created_at       timestamptz

-- account_overrides: ajuste sob medida por cliente (NULL = vale o do plano)
account_id    uuid PK → accounts ON DELETE CASCADE
interval_min  integer 10..240
max_channels  smallint 1|2
max_per_run   smallint 1..20
price_cents   integer          -- preço especial: tem prioridade sobre plano e promoção
promotion_id  uuid → promotions ON DELETE SET NULL
reason        text             -- motivo (aparece só no admin)
updated_at    timestamptz
```

**Como a plataforma aplica:**

- **Limites:**
  - em teste grátis valem os do plano `pro`, que é o plano de teste e **não pode ser excluído**;
  - fora do teste, valem os do plano em `accounts.plan`;
  - os campos preenchidos em `account_overrides` substituem os do plano, inclusive durante o teste.
- **Promoção automática** (sem código):
  - o site mostra o preço riscado, a descrição e a data de fim;
  - quando há mais de uma, vale a de menor preço final;
  - `extra_trial_days` aumenta os dias de teste anunciados.
- **No cadastro:** o cupom digitado ou, sem cupom, a melhor promoção automática do plano é consumido de forma atômica. O efeito depende do tipo:
  - `extra_trial_days` soma dias ao `trial_ends_at`;
  - desconto (`percent`/`fixed`) grava `account_overrides.promotion_id`.

  Um cupom inválido, expirado, esgotado ou de outro plano é recusado. Aceite `?cupom=CODIGO` em links de divulgação: `/cadastro?plano=pro&cupom=CODIGO`.
- **Preço da conta**, na tela Conta do cliente e na receita mensal do admin, nesta ordem de prioridade:
  1. `account_overrides.price_cents`;
  2. promoção vinculada, se `active` e o plano atual estiver em `plan_ids`, mesmo depois de `ends_at`, porque o preço fica garantido para quem entrou;
  3. `plans.price_cents`.
- **Validação dupla:** a plataforma revalida tudo que lê. Um `schedule` inválido vira 06:00–23:00 e números fora da faixa são limitados. Mesmo assim, o painel deve validar antes de gravar.

**Regras para o painel:**

- Plano: `id` é imutável. Não exclua um plano com contas usando, nem o `pro`; ofereça "ocultar" (`visible = false`).
- Ao mudar limites de um plano ou um override, grave `next_run_at = NULL` nas contas afetadas para o worker reagendar.
- Promoção: só desative (`active = false`); não apague promoções que já tiveram resgates. Códigos sempre em MAIÚSCULAS.
- Mostre no detalhe do cliente o preço final calculado com a mesma regra de prioridade acima.
- Os textos fixos do site (FAQ) citam Start, Pro e Escala. Avise na tela de planos que renomear um plano exige revisar esses textos.

Tabelas próprias do painel (o painel cria, com migração idempotente):

```sql
CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL, name text NOT NULL, password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','operator','viewer')),
  totp_secret text, disabled boolean NOT NULL DEFAULT false,
  last_login_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id bigserial PRIMARY KEY,
  admin_user_id uuid REFERENCES admin_users(id),
  action text NOT NULL,            -- ex.: account.status, plan.update, promo.create
  account_id uuid,                 -- sem FK: o log sobrevive à exclusão da conta
  before jsonb, after jsonb, ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

## 6. Funcionalidades

1. **Login do admin:**
   - usuários em `admin_users`, senha scrypt, 2FA TOTP opcional;
   - cookie HttpOnly, Secure, SameSite=Strict, assinado com `ADMIN_SESSION_SECRET`, expira em 12 h;
   - bloqueio de 15 min após 5 erros;
   - o primeiro `owner` é criado por um script de CLI (`npm run create-admin`), nunca por tela pública.
2. **Papéis:**
   - `viewer` só lê;
   - `operator` muda status, plano e teste, confirma e-mail e reseta senha;
   - `owner` faz tudo isso e também exclui contas, edita planos e promoções e gerencia admins.
3. **Dashboard:**
   - totais de contas, ativas, em teste, testes vencidos e novas em 7 dias;
   - MRR estimado (ativas × preço do plano, ou `price_cents` do override);
   - cadastros por dia;
   - status do worker (heartbeat);
   - publicações e falhas em 24 h.
4. **Clientes (lista):**
   - busca por nome ou e-mail;
   - filtros por status, plano, teste vencido, e-mail não confirmado e "sem credencial da Shopee";
   - ordenação e paginação no servidor (50 por página);
   - colunas: nome, e-mail, plano, status, dias de teste restantes, último login, última rodada, publicadas e falhas em 7 dias.
5. **Cliente (detalhe):**
   - dados cadastrais e anotações;
   - checklist de configuração, a partir das chaves de `account_settings`, sem valores;
   - últimas rodadas e envios;
   - ações: trocar plano, ativar, suspender, cancelar, estender teste (+3, +7, +14 ou N dias), aplicar override de limites ou preço, aplicar promoção, confirmar e-mail, resetar senha, desconectar todas as sessões e excluir conta;
   - histórico de auditoria da conta.
6. **Planos:** CRUD da tabela `plans`, com prévia do card como aparece no site e validação (ciclo dentro das opções permitidas, horário `HH:MM`).
7. **Promoções:** CRUD com período, limite de usos, planos atingidos, ativar e desativar, e contador de resgates.
8. **Auditoria:** lista filtrável de `admin_audit_log`, com exportação para CSV.

## 7. Segurança (requisitos, não sugestões)

- Toda rota e toda Server Action checa a sessão e o papel no servidor. Esconder o botão não basta.
- Nunca leia `account_settings.value`, nem exiba `password_hash`, `token_hash` ou `EVOLUTION_API_KEY`.
- Rate limit no login. Cabeçalhos `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` e CSP.
- Ações destrutivas pedem confirmação digitada.
- Pool do `pg` com `max: 5`. O painel não pode competir por conexões com o worker.
- O painel deve ficar fora do domínio público ou atrás de VPN, Cloudflare Access ou IP allowlist. Documente isso.

## 8. Entregáveis

1. Projeto Next.js completo, com `README.md` cobrindo: setup local, deploy na mesma VPS da plataforma e a criação do papel `aa_admin_panel`.
2. `docker-compose.yml` ligado à rede externa `autoachados_default` e `.env.example`.
3. Migração idempotente só das tabelas `admin_*` (seção 5). `plans`, `promotions` e `account_overrides` já existem e já vêm populadas pela plataforma.
4. Script `create-admin`.
5. Testes das regras da seção 4 contra um Postgres de teste:
   - `next_run_at = NULL` ao mudar plano ou status;
   - extensão de teste;
   - formato do hash scrypt;
   - exclusão em cascata;
   - auditoria gravada.
