// Processamento da fila de vídeos (executado pelo worker de vídeos).
//
//   PENDING ──enviar──▶ GENERATING ──pronto──▶ PROCESSING ──armazenado──▶ GENERATED ─▶ PENDING_REVIEW
//      ▲                   │  falha temporária: volta para PENDING (reenvio)
//      └───────────────────┘
//   qualquer falha definitiva (ou tentativas esgotadas) ─▶ FAILED
//
// Cada projeto é "reservado" (locked_until) com FOR UPDATE SKIP LOCKED: várias instâncias do
// worker podem rodar sem processar o mesmo vídeo. Se o worker cair no meio, a reserva expira
// e outro retoma do estado gravado (o id do job no provedor fica salvo).
import { canTransition, NARRATIONS, type GenerationOptions, type ProductSnapshot, type VideoFormat, type VideoStatus } from '@/lib/videos';
import { q } from '@/server/db';
import { imageMime, inspectVideo, looksLikeMp4, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from './media';
import { createProvider } from './providers';
import { ProviderError, type GenerationResult, type VideoGenerationProvider } from './providers/types';
import { getProviderWithKey, logEvent } from './repo';
import { getStorage, thumbKey, videoKey } from './storage';

export const MAX_ATTEMPTS = Number(process.env.VIDEO_MAX_ATTEMPTS || 3);
const POLL_SEC = Number(process.env.VIDEO_POLL_SEC || 15);
const GENERATION_TIMEOUT_MIN = Number(process.env.VIDEO_GENERATION_TIMEOUT_MIN || 60);
const LEASE_MIN = 10;

export type Job = {
  id: string; account_id: string; provider_id: string | null; provider_type: string; model: string; prompt: string; status: VideoStatus;
  options: GenerationOptions; product_snapshot: ProductSnapshot; requested_duration: number; requested_format: VideoFormat;
  provider_job_id: string | null; attempts: number; created_at: Date; updated_at: Date;
};

export async function claimJobs(limit: number): Promise<Job[]> {
  return q<Job>(
    `WITH due AS (
       SELECT id FROM video_projects
       WHERE status IN ('PENDING','GENERATING','PROCESSING') AND next_attempt_at <= now()
         AND (locked_until IS NULL OR locked_until < now())
       ORDER BY next_attempt_at LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE video_projects p SET locked_until = now() + interval '${LEASE_MIN} minutes'
     FROM due WHERE p.id = due.id RETURNING p.*`,
    [limit]
  );
}

// Muda o status só se ele ainda for `from` (protege contra corridas) e se a transição for válida.
async function move(job: Job, to: VideoStatus, extra: Record<string, unknown> = {}): Promise<boolean> {
  if (job.status !== to && !canTransition(job.status, to)) throw new Error(`Transição inválida ${job.status} → ${to}`);
  const sets = ['status = $3', 'updated_at = now()'];
  const params: unknown[] = [job.id, job.status, to];
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'next_in_sec') { params.push(v); sets.push(`next_attempt_at = now() + ($${params.length} * interval '1 second')`); continue; }
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  const r = await q(`UPDATE video_projects SET ${sets.join(', ')} WHERE id = $1 AND status = $2 RETURNING id`, params);
  if (r.length) job.status = to;
  return r.length > 0;
}

const release = (job: Job) => q('UPDATE video_projects SET locked_until = NULL WHERE id = $1', [job.id]);
const backoffSec = (attempt: number) => Math.min(30 * 2 ** (attempt - 1), 600); // 30 s, 60 s, 120 s…

async function fail(job: Job, message: string, ms?: number) {
  await move(job, 'FAILED', { error_message: message.slice(0, 1000) });
  await logEvent({ accountId: job.account_id, projectId: job.id, provider: job.provider_type, event: 'generation.failed', error: message, ms });
}

// Falha durante o envio/consulta: temporária → tenta de novo; definitiva → FAILED.
async function handleError(job: Job, err: unknown, stage: string, ms: number, retryTo: VideoStatus) {
  const retryable = err instanceof ProviderError ? err.retryable : false;
  const msg = (err as Error)?.message || String(err);
  const attempts = job.attempts + 1;
  await logEvent({ accountId: job.account_id, projectId: job.id, provider: job.provider_type, event: `${stage}.error`, error: msg, ms, response: { retryable, attempt: attempts } });
  if (retryable && attempts < MAX_ATTEMPTS) {
    await move(job, retryTo, { attempts, error_message: `Tentativa ${attempts} falhou: ${msg}`.slice(0, 1000), next_in_sec: backoffSec(attempts) });
  } else {
    await fail(job, retryable ? `${msg} (após ${attempts} tentativas)` : msg, ms);
  }
}

// Foto do produto como referência: apenas a URL fornecida pela API de afiliados da Shopee
// (nada de raspagem de página). Só HTTPS, só imagem, até 10 MB.
export async function fetchReferenceImage(url: string | null, doFetch: typeof fetch = fetch): Promise<{ url: string; data: Buffer; mimeType: string } | null> {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  try {
    const res = await doFetch(u, { signal: AbortSignal.timeout(20_000), redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;
    const mime = imageMime(buf);
    return mime ? { url, data: buf, mimeType: mime } : null;
  } catch {
    return null;
  }
}

// Problema definitivo na conta do provedor (ex.: sem plano pago): o provedor fica com status
// "error" e some da tela de geração, para não gerar novos vídeos que vão falhar e consumir o
// limite diário. Volta ao normal quando o cliente clica em "Testar conexão".
async function flagProviderAccount(job: Job, issue: string) {
  if (!job.provider_id) return;
  await q(
    `UPDATE ai_providers SET connection_status = 'error', connection_message = $3, updated_at = now() WHERE account_id = $1 AND id = $2`,
    [job.account_id, job.provider_id, issue.slice(0, 500)]
  );
  await logEvent({ accountId: job.account_id, projectId: job.id, provider: job.provider_type, event: 'provider.account_issue', error: issue });
}

async function providerFor(job: Job): Promise<VideoGenerationProvider | string> {
  if (!job.provider_id) return 'O provedor de IA usado neste vídeo foi removido.';
  const p = await getProviderWithKey(job.account_id, job.provider_id);
  if (!p) return 'O provedor de IA usado neste vídeo foi removido.';
  if (!p.enabled) return 'O provedor de IA foi desativado.';
  return createProvider(p.type, { apiKey: p.apiKey, settings: p.settings });
}

/* ------------------------------------------------------------------ Etapas */
async function submit(job: Job, provider: VideoGenerationProvider) {
  const caps = provider.getCapabilities().models.find((m) => m.id === job.model);
  const image = caps?.imageInput !== false ? await fetchReferenceImage(job.product_snapshot.imageUrl) : null;
  const req = {
    model: job.model, prompt: job.prompt, format: job.requested_format, duration: job.requested_duration,
    resolution: job.options.resolution || caps?.defaultResolution || '720p',
    withAudio: NARRATIONS[job.options.narration]?.needsAudio ?? true,
    referenceImage: image,
  };
  // Payload registrado SEM chave e sem binário (só tamanho da imagem)
  const logged = { ...req, prompt: `${job.prompt.length} caracteres`, referenceImage: image ? { url: image.url, bytes: image.data.length, mimeType: image.mimeType } : null };
  const t0 = Date.now();
  try {
    const sub = await provider.generateVideo(req);
    const ms = Date.now() - t0;
    await move(job, 'GENERATING', { provider_job_id: sub.jobId, error_message: null, next_in_sec: POLL_SEC });
    await logEvent({ accountId: job.account_id, projectId: job.id, provider: job.provider_type, event: 'generation.submitted', request: logged, response: { jobId: sub.jobId, ...sub.requestMeta }, ms });
  } catch (err) {
    // continua PENDING (reenvio) ou FAILED
    await handleError(job, err, 'generation.submit', Date.now() - t0, 'PENDING');
  }
}

async function poll(job: Job, provider: VideoGenerationProvider) {
  if (!job.provider_job_id) return fail(job, 'Job sem identificador do provedor.');
  const t0 = Date.now();
  let st;
  try {
    st = await provider.getGenerationStatus(job.provider_job_id);
  } catch (err) {
    // Erro ao CONSULTAR: tenta consultar de novo (não reenvia a geração)
    const retryable = err instanceof ProviderError ? err.retryable : false;
    if (retryable && job.attempts + 1 < MAX_ATTEMPTS * 3) {
      await q(`UPDATE video_projects SET attempts = attempts + 1, next_attempt_at = now() + interval '${POLL_SEC * 2} seconds' WHERE id = $1`, [job.id]);
      return logEvent({ accountId: job.account_id, projectId: job.id, provider: job.provider_type, event: 'generation.poll.error', error: (err as Error).message, ms: Date.now() - t0 });
    }
    return fail(job, (err as Error).message, Date.now() - t0);
  }
  if (st.state === 'running') {
    const ageMin = (Date.now() - new Date(job.updated_at).getTime()) / 60000;
    if (ageMin > GENERATION_TIMEOUT_MIN) return fail(job, `O provedor não terminou em ${GENERATION_TIMEOUT_MIN} minutos.`);
    await q(`UPDATE video_projects SET next_attempt_at = now() + interval '${POLL_SEC} seconds' WHERE id = $1`, [job.id]);
    return;
  }
  if (st.state === 'failed') {
    await logEvent({ accountId: job.account_id, projectId: job.id, provider: job.provider_type, event: 'generation.provider_failed', error: st.error, response: st.meta, ms: Date.now() - t0 });
    if (st.retryable && job.attempts + 1 < MAX_ATTEMPTS) {
      return move(job, 'PENDING', { attempts: job.attempts + 1, provider_job_id: null, error_message: st.error.slice(0, 1000), next_in_sec: backoffSec(job.attempts + 1) });
    }
    if (st.accountIssue) await flagProviderAccount(job, st.accountIssue);
    return fail(job, st.error);
  }
  await logEvent({ accountId: job.account_id, projectId: job.id, provider: job.provider_type, event: 'generation.completed', response: st.meta, ms: Date.now() - t0 });
  if (await move(job, 'PROCESSING', { attempts: 0, error_message: null })) await store(job, provider, st.result);
}

async function store(job: Job, provider: VideoGenerationProvider, result?: GenerationResult) {
  const t0 = Date.now();
  try {
    if (!result) {
      // Retomada após queda: busca o resultado de novo no provedor
      if (!job.provider_job_id) return fail(job, 'Job sem identificador do provedor.');
      const st = await provider.getGenerationStatus(job.provider_job_id);
      if (st.state !== 'succeeded') return fail(job, st.state === 'failed' ? st.error : 'O resultado não está mais disponível no provedor.');
      result = st.result;
    }
    const video = await provider.downloadResult(result, MAX_VIDEO_BYTES);
    if (!looksLikeMp4(video)) return fail(job, 'O provedor devolveu um arquivo que não é MP4.', Date.now() - t0);
    let meta;
    try {
      meta = await inspectVideo(video);
    } catch (err) {
      return fail(job, `Arquivo de vídeo inválido: ${(err as Error).message}`, Date.now() - t0);
    }
    const storage = getStorage();
    const vKey = videoKey(job.account_id, job.id);
    const tKey = meta.thumbnail ? thumbKey(job.account_id, job.id) : null;
    await storage.put(vKey, video, 'video/mp4');
    if (tKey && meta.thumbnail) await storage.put(tKey, meta.thumbnail, 'image/jpeg');
    const resolution = meta.width && meta.height ? `${meta.width}x${meta.height}` : null;
    await q(
      `INSERT INTO generated_videos (project_id, account_id, storage_path, thumbnail_path, duration, resolution, file_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (project_id) DO UPDATE SET storage_path = EXCLUDED.storage_path, thumbnail_path = EXCLUDED.thumbnail_path,
         duration = EXCLUDED.duration, resolution = EXCLUDED.resolution, file_size = EXCLUDED.file_size, status = 'STORED'`,
      [job.id, job.account_id, vKey, tKey, meta.duration, resolution, video.length]
    );
    await move(job, 'GENERATED');
    await move(job, 'PENDING_REVIEW');
    await logEvent({
      accountId: job.account_id, projectId: job.id, provider: job.provider_type, event: 'video.stored',
      response: { bytes: video.length, duration: meta.duration, resolution, thumbnail: !!tKey }, ms: Date.now() - t0,
    });
  } catch (err) {
    // Falha de download/armazenamento: tenta de novo continuando em PROCESSING
    const retryable = err instanceof ProviderError ? err.retryable : true;
    const attempts = job.attempts + 1;
    await logEvent({ accountId: job.account_id, projectId: job.id, provider: job.provider_type, event: 'video.store.error', error: (err as Error).message, ms: Date.now() - t0 });
    if (retryable && attempts < MAX_ATTEMPTS) {
      await q(`UPDATE video_projects SET attempts = $2, error_message = $3, next_attempt_at = now() + ($4 * interval '1 second'), updated_at = now() WHERE id = $1`,
        [job.id, attempts, `Armazenamento falhou (tentativa ${attempts}): ${(err as Error).message}`.slice(0, 1000), backoffSec(attempts)]);
    } else {
      await fail(job, (err as Error).message);
    }
  }
}

export async function processJob(job: Job): Promise<void> {
  try {
    const provider = await providerFor(job);
    if (typeof provider === 'string') return void (await fail(job, provider));
    if (job.status === 'PENDING') await submit(job, provider);
    else if (job.status === 'GENERATING') await poll(job, provider);
    else if (job.status === 'PROCESSING') await store(job, provider);
  } finally {
    await release(job);
  }
}
