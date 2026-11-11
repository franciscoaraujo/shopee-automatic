// Integração do Shopee Video Studio com PostgreSQL, armazenamento S3 e ffmpeg reais.
// Rode com: docker compose -f docker-compose.test.yml run --rm tests
//
// O provedor "testvideo" abaixo é um DUBLÊ DE TESTE: existe só neste arquivo, para exercitar
// a fila/estados/armazenamento sem gastar créditos de API. Ele não é registrado no produto.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB = process.env.TEST_DATABASE_URL;
const HAS_S3 = !!process.env.S3_ACCESS_KEY_ID;
const suite = DB ? describe : describe.skip;

process.env.DATABASE_URL = DB;
process.env.APP_MASTER_KEY ??= 'a'.repeat(64);
process.env.VIDEO_DAILY_LIMIT = '6';
process.env.VIDEO_MAX_ACTIVE = '3';
process.env.VIDEO_MAX_ATTEMPTS = '2';
process.env.PLATFORM_GEMINI_API_KEY = 'chave-da-plataforma-teste';
process.env.PREMIUM_VIDEOS_TRIAL = '1';

type Mods = {
  db: typeof import('@/server/db');
  mig: typeof import('@/server/migrations');
  repo: typeof import('@/server/videos/repo');
  proc: typeof import('@/server/videos/processor');
  providers: typeof import('@/server/videos/providers');
  types: typeof import('@/server/videos/providers/types');
  storage: typeof import('@/server/videos/storage');
  signed: typeof import('@/server/videos/signed-url');
  route: typeof import('@/app/api/videos/media/route');
};
let m: Mods;

const A = randomUUID(); // conta principal
const B = randomUUID(); // outra conta (isolamento)
const U = randomUUID();
const OPTS = { style: 'promo', narration: 'none', language: 'pt-BR', voiceInstructions: '', extraInstructions: '', resolution: '720p' } as const;

// MP4 real (2 s, 360x640) para o dublê de provedor devolver
function makeMp4(): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), 'aa-int-'));
  const out = path.join(dir, 'v.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=24', '-t', '2', '-pix_fmt', 'yuv420p', '-y', out]);
  return readFileSync(out);
}

// Comportamento do dublê, controlado por teste
const fake: { submit: 'ok' | 'retryable' | 'fatal'; quota: boolean; polls: number; mp4: Buffer } = { submit: 'ok', quota: false, polls: 0, mp4: Buffer.alloc(0) };

suite('Shopee Video Studio (integração)', () => {
  beforeAll(async () => {
    if (!/test/.test(DB!)) throw new Error('TEST_DATABASE_URL precisa apontar para um banco de teste');
    const { Pool } = await import('pg');
    const admin = new Pool({ connectionString: DB });
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await admin.end();

    m = {
      db: await import('@/server/db'), mig: await import('@/server/migrations'), repo: await import('@/server/videos/repo'),
      proc: await import('@/server/videos/processor'), providers: await import('@/server/videos/providers'),
      types: await import('@/server/videos/providers/types'), storage: await import('@/server/videos/storage'),
      signed: await import('@/server/videos/signed-url'), route: await import('@/app/api/videos/media/route'),
    };
    await m.db.migrate();

    fake.mp4 = makeMp4();
    const { ProviderError } = m.types;
    m.providers.PROVIDERS.testvideo = {
      type: 'testvideo', label: 'Dublê de teste', docsUrl: '', keyHelp: '', clientConfigurable: true,
      capabilities: { videoGeneration: true, models: [] },
      create: () => ({
        type: 'testvideo',
        validateConnection: async () => ({ ok: true, message: 'ok', models: [] }),
        getAvailableModels: async () => [],
        getCapabilities: () => ({ videoGeneration: true, models: [] }),
        generateVideo: async () => {
          if (fake.submit === 'retryable') throw new ProviderError('HTTP 503 temporário', true, 503);
          if (fake.submit === 'fatal') throw new ProviderError('Prompt recusado', false, 400);
          return { jobId: `job-${randomUUID()}`, requestMeta: {} };
        },
        getGenerationStatus: async () => fake.quota
          ? { state: 'failed', error: 'Sem cota', retryable: true, accountIssue: 'Plano pago necessário (teste)' }
          : (++fake.polls % 2 === 1
          ? { state: 'running', progress: 50 }
          : { state: 'succeeded', result: { kind: 'inline', data: fake.mp4.toString('base64'), mimeType: 'video/mp4' } }),
        downloadResult: async (r) => Buffer.from((r as { data: string }).data, 'base64'),
      }),
    };

    const { q } = m.db;
    for (const id of [A, B]) await q(`INSERT INTO accounts (id, name, status) VALUES ($1, 'Loja', 'active')`, [id]);
    await q(`INSERT INTO users (id, account_id, name, email, password_hash) VALUES ($1, $2, 'Ana', $3, 'x')`, [U, A, `${U}@t.local`]);
    const run = await q<{ id: number }>(`INSERT INTO runs (account_id, keyword) VALUES ($1, 'cozinha') RETURNING id`, [A]);
    // mesmo produto em 2 canais (2 linhas em deliveries) + outro produto
    for (const ch of ['whatsapp', 'telegram']) {
      await q(`INSERT INTO deliveries (account_id, run_id, channel, item_id, product_name, price, discount_rate, affiliate_link, success)
               VALUES ($1, $2, $3, '111', 'Garrafa Térmica 1L', 80, 20, 'https://s.shopee.com.br/a', true)`, [A, run[0].id, ch]);
    }
    await q(`INSERT INTO deliveries (account_id, run_id, channel, item_id, product_name, price, success) VALUES ($1, $2, 'whatsapp', '222', 'Fone Bluetooth', 59.9, true)`, [A, run[0].id]);
    await q(`INSERT INTO deliveries (account_id, run_id, channel, item_id, product_name, price, success) VALUES ($1, NULL, 'whatsapp', '333', 'Item de outra conta', 10, true)`, [B]);
  });

  afterAll(async () => { await m?.db.pool().end(); });

  /* ---------------------------------------------------------------- migrations */
  it('aplica as migrations uma única vez', async () => {
    const ids = (await m.db.q<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id')).map((r) => r.id);
    expect(ids).toEqual(['001_deliveries_product_fields', '002_video_studio', '003_platform_videos']);
    expect(await m.mig.runMigrations(m.db.pool())).toEqual([]);
  });

  /* ---------------------------------------------------------------- produtos */
  it('lista produtos do histórico sem duplicar e com preço original', async () => {
    const r = await m.repo.listProducts(A, {});
    expect(r.total).toBe(2);
    const g = r.items.find((p) => p.itemId === '111')!;
    expect(g).toMatchObject({ name: 'Garrafa Térmica 1L', price: 80, discountRate: 20, originalPrice: 100, category: 'cozinha' });
    expect((await m.repo.listProducts(A, { search: 'fone' })).items.map((p) => p.itemId)).toEqual(['222']);
    expect((await m.repo.listProducts(A, { search: '100%_' })).total).toBe(0);          // curingas escapados
    expect((await m.repo.listProducts(A, { category: 'cozinha' })).total).toBe(2);
    expect((await m.repo.listProducts(B, {})).items.map((p) => p.itemId)).toEqual(['333']);
  });

  /* ---------------------------------------------------------------- provedores */
  let providerId = '';
  it('guarda a chave criptografada e nunca a devolve na listagem', async () => {
    await expect(m.repo.createProvider(A, { type: 'xai', name: '', apiKey: 'curta' })).rejects.toThrow(/inválida|formato/);
    await expect(m.repo.createProvider(A, { type: 'inexistente', name: '', apiKey: 'x'.repeat(40) })).rejects.toThrow(/inválido/);
    // Gemini desativado (e, quando ativo, é só da plataforma): o cliente não cadastra chave
    await expect(m.repo.createProvider(A, { type: 'gemini', name: '', apiKey: 'AIza' + 'k'.repeat(35) })).rejects.toThrow(/inválido|fornecido pela plataforma/);
    const key = 'xai-' + 'k'.repeat(35);
    const gid = await m.repo.createProvider(A, { type: 'xai', name: 'Meu Grok', apiKey: key });
    const row = await m.db.one<{ api_key_encrypted: string; is_default: boolean }>('SELECT api_key_encrypted, is_default FROM ai_providers WHERE id = $1', [gid]);
    expect(row!.api_key_encrypted).not.toContain(key);
    expect(row!.is_default).toBe(true);                                                   // primeiro = padrão
    const list = await m.repo.listProviders(A);
    expect(JSON.stringify(list)).not.toContain(key);
    expect(list[0].keyHint).toBe('••••kkkk');
    expect((await m.repo.getProviderWithKey(A, gid))!.apiKey).toBe(key);
    expect(await m.repo.getProviderWithKey(B, gid)).toBeNull();                            // outra conta não lê

    providerId = await m.repo.createProvider(A, { type: 'testvideo', name: 'Teste', apiKey: 'chave-de-teste-123' });
    await m.repo.setDefaultProvider(A, providerId);
    expect((await m.repo.listProviders(A)).filter((p) => p.isDefault).map((p) => p.id)).toEqual([providerId]);
  });

  const MODEL = { id: 'fake-1', label: 'Fake', minDuration: 1, maxDuration: 15, aspectRatios: ['9:16', '16:9'], resolutions: ['720p'], defaultResolution: '720p', imageInput: false, audio: false, notes: [] } as const;
  const create = (key: string, products = ['111']) => m.repo.createProjects(A, U, {
    providerId, model: 'fake-1', format: '9:16', duration: 8, options: { ...OPTS },
    items: products.map((p) => ({ productId: p, prompt: `Prompt do produto ${p} com detalhes` })), requestKey: key,
  });

  /* ---------------------------------------------------------------- criação */
  it('exige conexão validada, respeita capacidades e é idempotente', async () => {
    await expect(create(randomUUID())).rejects.toThrow(/Teste a conexão/);
    await m.repo.saveValidation(A, providerId, { ok: true, message: 'ok', models: [{ ...MODEL, aspectRatios: [...MODEL.aspectRatios], resolutions: [...MODEL.resolutions], notes: [] }] });
    await expect(m.repo.createProjects(A, U, { providerId, model: 'fake-1', format: '1:1', duration: 8, options: { ...OPTS }, items: [{ productId: '111', prompt: 'x'.repeat(20) }], requestKey: randomUUID() }))
      .rejects.toThrow(/formato/);
    await expect(create(randomUUID(), ['333'])).rejects.toThrow(/não encontrado/);         // produto de outra conta

    const key = randomUUID();
    const first = await create(key);
    const again = await create(key);                                                      // clique duplo / reenvio
    expect(first.created).toBe(1);
    expect(again).toMatchObject({ created: 0, ids: first.ids });
    const p = await m.repo.getProject(A, first.ids[0]);
    expect(p).toMatchObject({ status: 'PENDING', product: { itemId: '111', price: 80, originalPrice: 100 } });
    expect(await m.repo.getProject(B, first.ids[0])).toBeNull();
  });

  it('não deixa avaliar antes de gerar e armazenar', async () => {
    const [id] = (await m.repo.listProjects(A, { period: 'all' })).items.map((p) => p.id);
    await expect(m.repo.addReview(A, U, { projectId: id, decision: 'APPROVED', comments: '', ratings: {} })).rejects.toThrow(/depois de gerado/);
  });

  it('limita vídeos simultâneos por conta', async () => {
    await create(randomUUID(), ['222']);
    await create(randomUUID());                                                            // 3 em andamento = limite
    await expect(create(randomUUID())).rejects.toThrow(/No máximo 3/);
  });

  /* ---------------------------------------------------------------- processador */
  const runQueue = async (times: number) => {
    for (let i = 0; i < times; i++) {
      await m.db.q(`UPDATE video_projects SET next_attempt_at = now() WHERE status IN ('PENDING','GENERATING','PROCESSING')`);
      for (const job of await m.proc.claimJobs(10)) await m.proc.processJob(job);
    }
  };

  const itS3 = HAS_S3 ? it : it.skip;
  itS3('gera, baixa, valida, armazena com miniatura e libera para avaliação', async () => {
    await runQueue(4);
    const list = await m.repo.listProjects(A, { period: 'all' });
    expect(list.items.map((p) => p.status)).toEqual(['PENDING_REVIEW', 'PENDING_REVIEW', 'PENDING_REVIEW']);
    const p = list.items[0];
    expect(p.video).toMatchObject({ resolution: '360x640', duration: 2 });
    expect(p.video!.thumbnailPath).toMatch(/thumb\.jpg$/);
    const events = (await m.repo.listLogs(A, p.id)).map((l) => l.event).reverse();
    expect(events).toEqual(['project.created', 'generation.submitted', 'generation.completed', 'video.stored']);
    // logs nunca guardam a chave
    expect(JSON.stringify(await m.db.q('SELECT * FROM video_generation_logs'))).not.toContain('chave-de-teste-123');
  });

  itS3('entrega o vídeo só com URL assinada, com suporte a Range', async () => {
    const p = (await m.repo.listProjects(A, { period: 'all' })).items[0];
    const url = `http://localhost${m.signed.signMediaUrl(p.video!.storagePath)}`;
    const full = await m.route.GET(new Request(url));
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(Buffer.from(await full.arrayBuffer()).subarray(4, 8).toString()).toBe('ftyp');
    const part = await m.route.GET(new Request(url, { headers: { range: 'bytes=0-99' } }));
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toMatch(/^bytes 0-99\//);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    expect((await m.route.GET(new Request(url.replace(/s=[^&]+/, 's=adulterada')))).status).toBe(403);
  });

  itS3('registra avaliações, permite reavaliar e gera nova versão a pedido', async () => {
    const [a, b] = (await m.repo.listProjects(A, { period: 'all' })).items;
    await m.repo.addReview(A, U, { projectId: a.id, decision: 'APPROVED', comments: 'Ótimo', ratings: { visual_quality: 5, product_fidelity: 4 } });
    expect((await m.repo.getProject(A, a.id))!.status).toBe('APPROVED');
    await m.repo.addReview(A, U, { projectId: a.id, decision: 'REJECTED', comments: 'Mudei de ideia', ratings: {} });
    const hist = await m.repo.listReviews(A, a.id);
    expect(hist.map((r) => r.decision)).toEqual(['REJECTED', 'APPROVED']);
    expect(hist[1].ratings).toEqual({ visual_quality: 5, product_fidelity: 4 });
    await expect(m.repo.addReview(A, U, { projectId: b.id, decision: 'APPROVED', comments: '', ratings: { visual_quality: 9 } })).rejects.toThrow(/1 a 5/);

    const { newProjectId } = await m.repo.addReview(A, U, { projectId: b.id, decision: 'REVISION_REQUESTED', comments: 'Mostrar o produto maior', ratings: {} });
    const v2 = await m.repo.getProject(A, newProjectId!);
    expect(v2).toMatchObject({ status: 'PENDING', version: 2, parentProjectId: b.id });
    expect(v2!.prompt).toContain('Ajustes solicitados na avaliação anterior:\nMostrar o produto maior');
    expect((await m.repo.getProject(A, b.id))!.status).toBe('REJECTED');
  });

  itS3('tenta de novo falhas temporárias e falha de vez nas definitivas', async () => {
    await runQueue(4);                                                                     // conclui a v2 pendente
    fake.submit = 'retryable';
    const t = await create(randomUUID(), ['222']);
    await runQueue(1);
    expect(await m.repo.getProject(A, t.ids[0])).toMatchObject({ status: 'PENDING', attempts: 1 });
    await runQueue(1);                                                                     // VIDEO_MAX_ATTEMPTS=2
    expect(await m.repo.getProject(A, t.ids[0])).toMatchObject({ status: 'FAILED', errorMessage: expect.stringContaining('após 2 tentativas') });

    fake.submit = 'fatal';
    const f = await create(randomUUID(), ['222']);
    await runQueue(1);
    expect(await m.repo.getProject(A, f.ids[0])).toMatchObject({ status: 'FAILED', attempts: 0, errorMessage: 'Prompt recusado' });
    fake.submit = 'ok';
  });

  itS3('falta de plano pago marca o provedor e bloqueia novas gerações até testar de novo', async () => {
    await m.repo.updateProvider(A, providerId, { settings: { paidPlanConfirmedAt: '2026-11-11T00:00:00.000Z' } });
    await m.repo.updateProvider(A, providerId, { name: 'Teste', settings: { defaultResolution: '720p' } });
    expect((await m.repo.getProvider(A, providerId))!.settings).toEqual({ paidPlanConfirmedAt: '2026-11-11T00:00:00.000Z', defaultResolution: '720p' });

    // libera uma vaga no limite diário (6 nos testes): remove um vídeo que já falhou
    await m.db.q("DELETE FROM video_projects WHERE id = (SELECT id FROM video_projects WHERE status = 'FAILED' ORDER BY created_at LIMIT 1)");
    fake.quota = true;
    const q1 = await create(randomUUID(), ['222']);
    await runQueue(4);                                                                     // envia, falha, tenta de novo, falha de vez
    expect(await m.repo.getProject(A, q1.ids[0])).toMatchObject({ status: 'FAILED', errorMessage: 'Sem cota' });
    const prov = (await m.repo.getProvider(A, providerId))!;
    expect(prov).toMatchObject({ status: 'error', message: 'Plano pago necessário (teste)' });
    await expect(create(randomUUID(), ['222'])).rejects.toThrow(/Teste a conexão/);       // fora da geração
    fake.quota = false;
    await m.repo.saveValidation(A, providerId, { ok: true, message: 'ok', models: prov.models }); // = "Testar conexão"
    expect((await m.repo.getProvider(A, providerId))!.status).toBe('ok');
  });

  itS3('limita gerações em 24 horas', async () => {
    await expect(create(randomUUID())).rejects.toThrow(/Limite de 6 vídeos em 24 horas/);
  });

  itS3('exclui vídeo, arquivos e registro', async () => {
    const p = (await m.repo.listProjects(A, { period: 'all', group: 'approved' })).items[0]
      ?? (await m.repo.listProjects(A, { period: 'all', group: 'review' })).items[0];
    const storage = m.storage.getStorage();
    await m.repo.deleteProject(A, p.id, (k) => storage.delete(k));
    expect(await m.repo.getProject(A, p.id)).toBeNull();
    await expect(storage.get(p.video!.storagePath)).rejects.toMatchObject({ name: 'NoSuchKey' });
    const del = await m.db.q(`SELECT event FROM video_generation_logs WHERE event = 'project.deleted'`);
    expect(del.length).toBe(1);
  });

  // GEMINI DESATIVADO POR ENQUANTO (PREMIUM_ENABLED = false): reative junto com o Gemini
  it.skip('premium: usa a IA da plataforma, respeita limites de custo e a cota mensal', async () => {
    (globalThis as { __platformStatus?: unknown }).__platformStatus = { at: Date.now(), ok: true, message: 'Disponível' };
    const { PLATFORM_PROVIDER_ID, premiumQuota } = await import('@/server/videos/platform');
    const premium = (key: string, duration = 10) => m.repo.createProjects(B, null, {
      providerId: PLATFORM_PROVIDER_ID, model: 'gemini-omni-1.2-flash', format: '9:16', duration, options: { ...OPTS },
      items: [{ productId: '333', prompt: 'Prompt premium do produto 333' }], requestKey: key,
    });
    await m.db.q('INSERT INTO account_overrides (account_id, premium_videos_month) VALUES ($1, 2)', [B]);
    expect(await premiumQuota(B)).toEqual({ limit: 2, used: 0, remaining: 2 });

    await expect(premium(randomUUID(), 12)).rejects.toThrow(/de 3 a 10 segundos/);         // teto de custo do operador
    const k = randomUUID();
    const p1 = await premium(k);
    expect((await premium(k)).created).toBe(0);                                           // idempotente: não gasta cota
    const p2 = await premium(randomUUID());
    expect(await premiumQuota(B)).toEqual({ limit: 2, used: 2, remaining: 0 });
    await expect(premium(randomUUID())).rejects.toThrow(/Cota de vídeos premium do mês: 2 de 2/);

    const v = (await m.repo.getProject(B, p1.ids[0]))!;
    expect(v).toMatchObject({ source: 'platform', providerId: null, providerType: 'gemini', providerLabel: 'Google Gemini (Premium)' });
    // nenhuma chave do cliente envolvida
    expect(await m.db.q('SELECT 1 FROM ai_providers WHERE account_id = $1', [B])).toEqual([]);

    await m.db.q("UPDATE video_projects SET status = 'FAILED' WHERE id = $1", [p2.ids[0]]);  // falha não conta
    expect((await premiumQuota(B)).remaining).toBe(1);

    await m.db.q('DELETE FROM account_overrides WHERE account_id = $1', [B]);
    expect((await premiumQuota(B)).limit).toBe(5);                                         // plano Pro (migration 003)
    await m.db.q("UPDATE accounts SET status = 'trial' WHERE id = $1", [B]);
    expect((await premiumQuota(B)).limit).toBe(1);                                         // PREMIUM_VIDEOS_TRIAL
    await m.db.q("UPDATE accounts SET status = 'active' WHERE id = $1", [B]);
  });

  it('painel conta por status e respeita filtros', async () => {
    const d = await m.repo.dashboard(A, { period: 'all' });
    expect(d.kpis.total).toBeGreaterThan(0);
    expect(d.kpis.total).toBe(d.kpis.processing + d.kpis.review + d.kpis.approved + d.kpis.rejected + d.kpis.failed);
    expect((await m.repo.dashboard(A, { period: 'all', provider: 'gemini' })).kpis.total).toBe(0);           // A não usou premium
    expect((await m.repo.dashboard(B, { period: 'all' })).kpis.total).toBe(0);
  });
});
