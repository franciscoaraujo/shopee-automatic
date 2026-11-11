// Worker de vídeos: processa a fila do Shopee Video Studio, separado do worker de ofertas
// (que pode estar desligado, por exemplo na instância de teste).
//   npm run video-worker      (produção: node dist/video-worker.mjs)
// Seguro para várias instâncias: cada vídeo é reservado com FOR UPDATE SKIP LOCKED.
import { migrate, q } from '@/server/db';
import { claimJobs, processJob, type Job } from '@/server/videos/processor';

const TICK_MS = Number(process.env.VIDEO_WORKER_TICK_MS || 5_000);
const CONCURRENCY = Number(process.env.VIDEO_WORKER_CONCURRENCY || 3);
let stopping = false;
let active = 0;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function run(job: Job) {
  active++;
  try {
    const before = job.status;
    await processJob(job);
    if (job.status !== before) log(`[vídeo ${job.id.slice(0, 8)}] ${before} → ${job.status}`);
  } catch (err) {
    log(`[vídeo ${job.id.slice(0, 8)}] erro inesperado:`, err);
  } finally {
    active--;
  }
}

async function tick() {
  await q(
    `INSERT INTO system_kv (key, value, updated_at) VALUES ('video_worker_heartbeat', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ active, pid: process.pid })]
  );
  const free = CONCURRENCY - active;
  if (free <= 0) return;
  for (const job of await claimJobs(free)) void run(job);
}

async function main() {
  await migrate();
  log(`Worker de vídeos iniciado · concorrência ${CONCURRENCY} · verificação a cada ${TICK_MS / 1000}s`);
  while (!stopping) {
    try {
      await tick();
    } catch (err) {
      log('Falha no ciclo:', err);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  while (active > 0) await new Promise((r) => setTimeout(r, 500));
  log('Worker de vídeos encerrado');
  process.exit(0);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log(`Recebido ${sig}, finalizando vídeos em andamento…`);
  });
}

void main();
