# AutoAchados — plataforma SaaS

Site de vendas, painel dos clientes, área administrativa e o worker que roda a esteira de ofertas
Shopee → WhatsApp/Telegram **para cada cliente**. Multi-tenant: um servidor atende todas as contas.

> A primeira versão (esteira de uso próprio com n8n) foi removida; está no histórico do git, commit `8dfacda`.

```
                 ┌──────────── web (Next.js 16) ────────────┐
 navegador ───▶  │ /            site de vendas              │
                 │ /cadastro    cria conta (7 dias de teste)│
                 │ /app         painel do cliente           │──┐
                 │ /admin       gestão de clientes          │  │
                 └──────────────────────────────────────────┘  │
                 ┌──────────── worker ──────────────────────┐  ├──▶ PostgreSQL
                 │ a cada 20 s reserva contas com rodada     │──┘     (contas, credenciais
                 │ vencida e roda: busca → filtra → link →   │         cifradas, rodadas,
                 │ legenda → publica → registra              │         envios)
                 └──────┬───────────────────────┬────────────┘
                        ▼                       ▼
              Shopee Affiliate API      Evolution API (1 instância de WhatsApp por cliente)
                                        Telegram Bot API (bot do próprio cliente)
```

## Como cada parte funciona

| Peça | Onde | Detalhes |
|---|---|---|
| Contas e login | `src/server/accounts.ts`, `session.ts` | Senha com scrypt; sessão em cookie HttpOnly com token aleatório (no banco só o SHA-256); 30 dias. |
| E-mails | `src/server/mail.ts`, `email-templates.ts`, `email-tokens.ts` | **Confirmação de cadastro:** o login só é liberado depois do clique no link, que leva ao login; há botão de reenvio. **Recuperação de senha** (`/recuperar-senha` → `/redefinir-senha`): o link vale 1 h, é de uso único e encerra todas as sessões; a resposta é a mesma exista a conta ou não. Links guardados só como SHA-256. Envio por SMTP (qualquer provedor). |
| Credenciais | `src/server/settings.ts`, `crypto.ts` | AES-256-GCM com `APP_MASTER_KEY`. O AAD amarra cada valor à conta e ao campo. Segredos nunca voltam ao navegador. |
| Planos e promoções | `src/server/plans.ts`, `src/lib/plans.ts` | Ficam no banco (`plans`, `promotions`, `account_overrides`): preço, ciclo mínimo, canais, ofertas por rodada, horário, visibilidade, promoções automáticas, cupons (`/cadastro?cupom=CODIGO`) e limites/preço sob medida por cliente. Lidos com cache de 30 s pelo site, painel e worker; mudanças valem sem reiniciar. A carga inicial vem de `DEFAULT_PLANS`, que também é a reserva se o banco falhar. Edição pelo painel administrativo separado (`docs/PROMPT-painel-admin.md`). |
| Esteira | `src/server/pipeline.ts` | Lógica dos Code Nodes do n8n portada para TypeScript; rodízio de palavra-chave e deduplicação **por conta** no banco; novas tentativas automáticas no erro 10000 da Shopee. |
| Frequência | `src/lib/plans.ts` | O cliente escolhe o ciclo (de 5 em 5 min até 1 h, depois até 4 h), nunca abaixo do mínimo do plano: Start 1 h, Pro 30 min, Escala 10 min. O worker agenda a próxima rodada pelo ciclo escolhido; ao reduzir o ciclo, a próxima rodada é antecipada. |
| Horário de envio | `src/lib/schedule.ts`, `plans.ts` | Por plano: **Start** fixo das 08h às 16h; **Pro** o cliente escolhe entre 06h e 23h e os dias; **Escala** controle total (24 h, madrugada). Regras aplicadas no worker e na validação, não só na tela. Fora da janela o worker agenda a conta direto para a próxima abertura. "Rodar agora" não é bloqueado. Em teste grátis valem os limites do Pro. |
| Worker | `src/worker/index.ts` | `FOR UPDATE SKIP LOCKED`: pode rodar mais de uma instância sem rodar a mesma conta duas vezes. Envia heartbeat (o admin mostra se parou). |
| WhatsApp | `src/server/integrations.ts` | Instância `aa_<id da conta>` criada automaticamente; o cliente lê o QR no próprio painel e escolhe o grupo numa lista. |
| Cobrança | `/admin` | Manual nesta versão: a conta nasce em teste (7 dias, limites do Pro) e você ativa, suspende, troca de plano ou estende o teste. |

## Subir em produção (VPS)

Requisitos: VPS com Docker, 4 GB de RAM ou mais, e um domínio apontando para o IP do servidor.

```bash
cp .env.example .env            # preencha (gere segredos com: openssl rand -hex 32)
docker compose --profile https up -d --build
```

- O site fica em `https://SEU_DOMINIO` (HTTPS automático via Caddy).
- O admin fica em `https://SEU_DOMINIO/admin`, com a senha `ADMIN_PASSWORD`.
- **Backup:**
  - **guarde o `APP_MASTER_KEY` fora do servidor**: sem ele, as credenciais dos clientes não podem ser lidas;
  - faça backup diário do banco: `docker compose exec postgres pg_dumpall -U autoachados > backup.sql`.

Para testar localmente sem domínio: `COOKIE_SECURE=false` no `.env` e `docker compose up -d --build`
(sem o perfil `https`); o site abre em http://localhost:3000.

## E-mail (obrigatório em produção)

Sem SMTP, novos clientes não recebem o link de confirmação e não conseguem entrar.
Configure no `.env` um provedor SMTP, por exemplo:

| Provedor | SMTP_HOST | SMTP_PORT | Observação |
|---|---|---|---|
| Brevo | `smtp-relay.brevo.com` | 587 | Plano grátis com 300 e-mails/dia |
| Resend | `smtp.resend.com` | 465 | Usuário `resend`, senha = API key |
| Amazon SES | `email-smtp.<região>.amazonaws.com` | 587 | Mais barato em volume |

Use um remetente do seu domínio (`MAIL_FROM`) e configure SPF/DKIM no DNS conforme o provedor,
senão os e-mails tendem a cair no spam.

**Desenvolvimento:** com `COMPOSE_PROFILES=mail-dev`, `SMTP_HOST=mailpit` e `SMTP_PORT=1025`, os e-mails
ficam presos numa caixa local em http://localhost:8025 (nada é enviado de verdade).

## Desenvolvimento

```bash
npm install
cp .env.example .env.local      # DATABASE_URL e EVOLUTION_API_URL apontando para serviços locais
npm run dev                     # site + painel em http://localhost:3000
npm run worker:dev              # worker (outro terminal)
```

Sem `APP_MASTER_KEY` em desenvolvimento, uma chave é gerada em `.data/master.key`.

## Personalizar

- **Preços, limites, textos dos planos e promoções:** tabelas `plans` e `promotions` no banco (pelo painel administrativo). `DEFAULT_PLANS` em `src/lib/plans.ts` só vale para um banco novo.
- **WhatsApp e e-mail de suporte, URL:** variáveis `NEXT_PUBLIC_*`. Elas entram no build, então rebuild após mudar.
- **Cor da marca:**
  ```bash
  npx esbuild scripts/gen-theme.mjs --bundle --platform=node --format=esm --outfile=.t.mjs && node .t.mjs "#COR" && rm .t.mjs
  ```
- **Ícones:** adicione o nome em `scripts/gen-icons.mjs` e rode `node scripts/gen-icons.mjs`.

## Segurança

- **Isolamento entre clientes:** toda consulta é filtrada pela conta da sessão; nenhuma ação aceita ID de conta vindo do navegador.
- **Ações do servidor:** Server Actions com verificação de origem do Next.js.
- **Limites de tentativas:**
  - login: por IP e por e-mail;
  - cadastro: por IP;
  - testes de conexão, QR Code e "Rodar agora": por conta.
- **Admin:** senha única com comparação em tempo constante; cookie assinado (HMAC) SameSite=Strict.
- **Exclusão de conta (LGPD):** desconecta o WhatsApp e apaga em cascata credenciais, histórico e sessões.
- **Cabeçalhos:** `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.

## Próximos passos sugeridos

- Pagamento automático (Mercado Pago ou Asaas) ativando/suspendendo contas por webhook.
- Recuperação de senha por e-mail (hoje o admin gera uma senha nova em `/admin`).
- Limite de tentativas em Redis quando houver mais de uma instância do `web`.
