# Shopee Video Studio

Módulo **Vídeos** do painel do cliente (`/app/videos`). Gera vídeos promocionais dos produtos do
Histórico de Ofertas com provedores de IA. Os vídeos são armazenados numa galeria interna e avaliados
por pessoas. **Nada é publicado**: aprovar um vídeo é só uma marcação interna.

## Arquitetura

```
 Painel (Next.js)                         Worker de vídeos (dist/video-worker.mjs)
 ─────────────────                        ─────────────────────────────────────────
 /app/videos            painel            a cada 5 s reserva projetos (FOR UPDATE SKIP LOCKED)
 /app/videos/gerar      gerar  ──cria──▶  PENDING ─▶ GENERATING ─▶ PROCESSING ─▶ GENERATED ─▶ PENDING_REVIEW
 /app/videos/galeria    galeria           │ envia ao     │ consulta     │ baixa, valida MP4,
 /app/videos/[id]       avaliação         │ provedor     │ o status     │ ffprobe + miniatura,
 /app/videos/ia         provedores        │              │              │ grava no S3
        │                                 └─ falha temporária: nova tentativa com backoff
        │                                    falha definitiva / tentativas esgotadas: FAILED
        ▼
 /api/videos/media  ◀── URL assinada (HMAC, 15 min) ──▶ armazenamento S3 privado
```

| Peça | Arquivo |
|---|---|
| Estados, transições, opções e validação contra capacidades | `src/lib/videos.ts` |
| Gerador de prompt (o mesmo na tela e no servidor) | `src/lib/video-prompt.ts` |
| Interface comum `VideoGenerationProvider` | `src/server/videos/providers/types.ts` |
| Adaptadores reais | `providers/gemini.ts` (`GeminiVideoProvider`), `providers/grok.ts` (`GrokVideoProvider`) |
| Registro de provedores | `src/server/videos/providers/index.ts` |
| Dados (sempre filtrados pela conta da sessão) | `src/server/videos/repo.ts` |
| Fila / processamento | `src/server/videos/processor.ts`, `src/worker/videos.ts` |
| Armazenamento S3, mídia, URLs assinadas | `storage.ts`, `media.ts`, `signed-url.ts`, `src/app/api/videos/media/route.ts` |
| Migrations versionadas | `src/server/migrations.ts` |

### Como adicionar um provedor

1. Crie `src/server/videos/providers/<nome>.ts` implementando `VideoGenerationProvider`:
   `validateConnection`, `getAvailableModels`, `getCapabilities`, `generateVideo`,
   `getGenerationStatus` e `downloadResult`.
2. Registre-o em `PROVIDERS` (`providers/index.ts`).

Fila, estados, armazenamento, telas e avaliação não mudam. Se o provedor não gerar vídeo, declare
`capabilities: { videoGeneration: false, limitation: '…', models: [] }`: a tela mostra a limitação.

## Provedores disponíveis (APIs conferidas em 11/2026)

| | Google Gemini | xAI Grok |
|---|---|---|
| Modelo | Gemini Omni Flash (`gemini-omni-1.2-flash`) | Grok Imagine Video (lista vinda da API) |
| API | `POST /v1beta/interactions` (background) + `GET /v1beta/interactions/{id}` | `POST /v1/videos/generations` + `GET /v1/videos/{id}` |
| Validação da chave | `GET /v1beta/models` | `GET /v1/video-generation-models` |
| Duração | 3–15 s | 1–15 s |
| Formatos | 9:16, 16:9 | 9:16, 16:9, 1:1 |
| Foto do produto como referência | sim | sim |
| Áudio / narração | sim; oficialmente avaliado só em inglês | sim |
| Onde obter a chave | aistudio.google.com → Get API key (projeto com faturamento) | console.x.ai → API Keys |

Os modelos Veo 3.1 Preview foram desligados na Gemini API em 22/10/2026. Por isso o adaptador usa o Omni Flash.

**Configuração:** cada cliente cadastra a própria chave em **Vídeos → Configurações de IA**. A chave é
criptografada (AES-256-GCM com `APP_MASTER_KEY`, AAD amarrado à conta e ao provedor). Ela nunca volta
ao navegador, aos logs nem às respostas: a tela mostra só os 4 últimos caracteres.

## Variáveis de ambiente

| Variável | Padrão | Para quê |
|---|---|---|
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — (obrigatórias) | Credenciais do armazenamento. Com o serviço `storage` do compose, gere com `openssl rand -hex 32` |
| `S3_ENDPOINT` | `http://storage:8333` | Vazio = AWS S3. Aceita R2, MinIO etc. |
| `S3_BUCKET` / `S3_REGION` / `S3_FORCE_PATH_STYLE` | `autoachados-videos` / `us-east-1` / `true` | O bucket é criado na primeira gravação |
| `VIDEO_DAILY_LIMIT` | 20 | Gerações por conta em 24 h (controle de custo) |
| `VIDEO_MAX_ACTIVE` | 5 | Vídeos em geração ao mesmo tempo por conta |
| `VIDEO_WORKER_REPLICAS` / `VIDEO_WORKER_CONCURRENCY` | 1 / 3 | Worker de vídeos |
| `VIDEO_MAX_ATTEMPTS` / `VIDEO_GENERATION_TIMEOUT_MIN` / `VIDEO_MAX_BYTES` | 3 / 60 / 200 MB | Tentativas, tempo-limite e tamanho máximo |

## Banco de dados

Migrations em `src/server/migrations.ts`, registradas em `schema_migrations` e aplicadas uma vez, com
advisory lock:

- `001_deliveries_product_fields`: `deliveries` passa a guardar `discount_rate`, `product_link` e `shop_name`.
- `002_video_studio`: tabelas `ai_providers`, `video_projects`, `generated_videos`, `video_reviews` e `video_generation_logs`.

Os produtos não são duplicados: `video_projects.product_id` é o `item_id` da Shopee, e `product_snapshot`
guarda nome, preço etc. no momento da geração.

## Segurança

- **Isolamento:** todas as consultas filtram pela conta da sessão. Ids vindos do navegador são conferidos.
- **Arquivos:** ficam privados no S3. O navegador recebe só URLs assinadas por 15 min, com suporte a `Range`.
- **Validação:** o MP4 é conferido pela assinatura `ftyp` e pelo `ffprobe`, com tamanho máximo. A foto de referência precisa ser HTTPS, imagem real e ter até 10 MB.
- **Custo:** há limite diário e de simultâneos por conta, rate limit nas ações e chave de idempotência por envio, então clique duplo não duplica.
- **Auditoria:** o cadastro e a troca de chave de provedores, as validações, as chamadas aos provedores, as avaliações e as exclusões ficam em `video_generation_logs`, sem chaves e sem binários.

## Testes

```bash
npm test                              # unitários (estados, prompt, adaptadores, URLs, mídia)
npm run test:integration:docker       # integração: Postgres + S3 + ffmpeg reais, descartáveis
TEST_REAL_PROVIDERS=1 npm run test:integration    # chama as APIs reais (com chave inválida)
TEST_REAL_PROVIDERS=1 TEST_GEMINI_API_KEY=... TEST_XAI_API_KEY=... npm run test:integration
```

## Limitações conhecidas

- **Duração:** 20 e 30 s não estão disponíveis, porque os dois provedores geram no máximo 15 s por chamada. Juntar clipes ou usar a extensão de vídeo fica para uma próxima versão.
- **Dados do produto:** a API de afiliados da Shopee não fornece descrição, imagens adicionais nem nome de categoria. O prompt usa só nome, preço e foto, e a "categoria" é a palavra-chave da busca. O preço original aparece só em produtos publicados depois desta versão.
- **Áudio no Gemini:** em português, o resultado pode variar, porque só o inglês foi avaliado oficialmente.
- **Publicação:** não existe nesta versão. A arquitetura permite acrescentar uma etapa autorizada depois de `APPROVED`.
