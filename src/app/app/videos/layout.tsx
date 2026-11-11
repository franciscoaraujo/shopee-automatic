import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Icon } from '@/components/icons';
import { one } from '@/server/db';
import { isStorageConfigured } from '@/server/videos/storage';
import { VideoTabs } from './tabs';

export const metadata: Metadata = { title: { default: 'Vídeos', template: '%s · Vídeos · AutoAchados' } };

// Avisos de infraestrutura: sem armazenamento ou sem worker, nada é gerado
async function SystemNotice() {
  await connection();
  const hb = await one<{ ok: boolean }>(`SELECT updated_at > now() - interval '2 minutes' AS ok FROM system_kv WHERE key = 'video_worker_heartbeat'`);
  const workerOk = !!hb?.ok;
  const storageOk = isStorageConfigured();
  if (workerOk && storageOk) return null;
  return (
    <div className="mt-6 flex items-start gap-3 rounded-lg border border-error/30 bg-error-container/60 p-4 text-body-m text-on-error-container">
      <Icon name="warning" className="mt-0.5 shrink-0" />
      <p>
        {!storageOk && 'O armazenamento de vídeos não está configurado (variáveis S3_*). '}
        {!workerOk && 'O processador de vídeos não está rodando: pedidos ficam na fila até ele voltar. '}
        Avise o suporte.
      </p>
    </div>
  );
}

export default function VideosLayout({ children }: LayoutProps<'/app/videos'>) {
  return (
    <main className="mx-auto max-w-7xl px-5 py-8 md:py-10">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-display-s">Shopee Video Studio</h1>
          <p className="mt-1 text-body-l text-on-surface-variant">Gere vídeos dos produtos do seu histórico com IA, avalie e aprove internamente.</p>
        </div>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-outline-variant px-2.5 text-label-m text-on-surface-variant">
          <Icon name="lock" size={16} /> Nada é publicado automaticamente
        </span>
      </div>
      <Suspense fallback={null}><SystemNotice /></Suspense>
      <div className="mt-6"><VideoTabs /></div>
      <div className="mt-6">{children}</div>
    </main>
  );
}
