'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Icon, type IconName } from '@/components/icons';
import type { VideoStatus } from '@/lib/videos';
import { deleteVideoAction, newVersionAction, quickDecisionAction, type ActionResult } from '../actions';

const btn = 'state-layer inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-label-l disabled:pointer-events-none disabled:opacity-40';

function A({ icon, label, onClick, disabled, tone = 'text-on-surface-variant' }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; tone?: string }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={`${btn} ${tone}`}><Icon name={icon} size={18} /> {label}</button>;
}

// Ações rápidas do cartão (aprovar/rejeitar sem notas, nova versão, excluir)
export function CardActions({ id, status, hasVideo, download }: { id: string; status: VideoStatus; hasVideo: boolean; download: string | null }) {
  const router = useRouter();
  const [res, setRes] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) => start(async () => { const r = await fn(); setRes(r); router.refresh(); });
  const reviewable = hasVideo && (status === 'PENDING_REVIEW' || status === 'APPROVED' || status === 'REJECTED');
  const busy = status === 'PENDING' || status === 'GENERATING' || status === 'PROCESSING';

  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {download && <a href={download} className={`${btn} text-on-surface-variant`} download><Icon name="download" size={18} /> MP4</a>}
        {reviewable && status !== 'APPROVED' && <A icon="thumb_up" label="Aprovar" tone="text-success" disabled={pending} onClick={() => run(() => quickDecisionAction(id, 'APPROVED'))} />}
        {reviewable && status !== 'REJECTED' && <A icon="thumb_down" label="Rejeitar" tone="text-error" disabled={pending} onClick={() => run(() => quickDecisionAction(id, 'REJECTED'))} />}
        {!busy && <A icon="autorenew" label="Nova versão" disabled={pending} onClick={() => run(() => newVersionAction(id, crypto.randomUUID()))} />}
        {!busy && (
          <A icon="delete" label="Excluir" tone="text-error" disabled={pending}
            onClick={() => { if (confirm('Excluir este vídeo? O arquivo e as avaliações serão apagados.')) run(() => deleteVideoAction(id)); }} />
        )}
      </div>
      {res?.message && <p role="status" className={`mt-1 px-3 text-body-s ${res.ok ? 'text-success' : 'text-error'}`}>{res.message}</p>}
    </div>
  );
}
