// Peças visuais do Shopee Video Studio (componentes de servidor, sem estado).
import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons';
import { FORMATS, STATUS_LABEL, type VideoStatus } from '@/lib/videos';
import type { ProjectView } from '@/server/videos/repo';
import { signMediaUrl } from '@/server/videos/signed-url';

export const brl = (v: number | null | undefined) => (v || v === 0 ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v) : '—');
export const dt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
export const fmtBytes = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

const STATUS_STYLE: Record<VideoStatus, { cls: string; icon: IconName }> = {
  PENDING: { cls: 'bg-surface-high text-on-surface-variant', icon: 'schedule' },
  GENERATING: { cls: 'bg-tertiary/12 text-tertiary', icon: 'autorenew' },
  PROCESSING: { cls: 'bg-tertiary/12 text-tertiary', icon: 'hourglass_top' },
  GENERATED: { cls: 'bg-tertiary/12 text-tertiary', icon: 'check' },
  PENDING_REVIEW: { cls: 'bg-secondary-container text-on-secondary-container', icon: 'rate_review' },
  APPROVED: { cls: 'bg-success-container text-on-success-container', icon: 'thumb_up' },
  REJECTED: { cls: 'bg-error-container text-on-error-container', icon: 'thumb_down' },
  FAILED: { cls: 'bg-error-container text-on-error-container', icon: 'error' },
};

export function StatusChip({ status }: { status: VideoStatus }) {
  const s = STATUS_STYLE[status];
  const spinning = status === 'GENERATING' || status === 'PROCESSING';
  return (
    <span className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-xs px-2 text-label-s ${s.cls}`}>
      <Icon name={s.icon} size={14} className={spinning ? 'animate-spin [animation-duration:2.5s]' : ''} /> {STATUS_LABEL[status]}
    </span>
  );
}

export function Card({ title, description, action, children, className = '' }: { title?: string; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-outline-variant/70 bg-surface-lowest p-6 ${className}`}>
      {(title || action) && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-title-l">{title}</h2>}
            {description && <p className="mt-1 text-body-m text-on-surface-variant">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary"><Icon name={icon} size={28} /></span>
      <p className="mt-4 text-title-m">{title}</p>
      {children && <div className="mt-2 max-w-md text-body-m text-on-surface-variant">{children}</div>}
    </div>
  );
}

// URLs assinadas (curta validade) para miniatura, player e download
export function mediaUrls(p: ProjectView) {
  if (!p.video) return null;
  const safe = p.product.name.replace(/[^\w .()-]+/g, ' ').trim().slice(0, 60) || 'video';
  return {
    thumb: p.video.thumbnailPath ? signMediaUrl(p.video.thumbnailPath) : null,
    play: signMediaUrl(p.video.storagePath),
    download: signMediaUrl(p.video.storagePath, { disposition: 'attachment', filename: `${safe} v${p.version}.mp4` }),
  };
}

const ASPECT: Record<string, string> = { '9:16': 'aspect-[9/16]', '16:9': 'aspect-video', '1:1': 'aspect-square' };

export function Thumb({ p, className = '' }: { p: ProjectView; className?: string }) {
  const urls = mediaUrls(p);
  return (
    <div className={`relative overflow-hidden bg-surface-container ${ASPECT[p.format] ?? 'aspect-video'} ${className}`}>
      {urls?.thumb
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={urls.thumb} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
        : p.product.imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={p.product.imageUrl} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover opacity-40 blur-[1px]" loading="lazy" />
          : null}
      {urls && <span className="absolute inset-0 grid place-items-center"><span className="grid size-12 place-items-center rounded-full bg-black/55 text-white"><Icon name="play_arrow" size={28} /></span></span>}
      <span className="absolute bottom-2 left-2 rounded-xs bg-black/60 px-1.5 text-label-s text-white">{FORMATS[p.format].label.split(' ')[1]} · {p.video?.duration ? `${Math.round(p.video.duration)} s` : `${p.duration} s`}</span>
    </div>
  );
}

export function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} scroll={false} aria-current={active ? 'true' : undefined}
      className={`state-layer inline-flex h-8 items-center gap-1.5 rounded-sm border px-3 text-label-l ${active ? 'border-transparent bg-secondary-container text-on-secondary-container' : 'border-outline text-on-surface-variant'}`}>
      {active && <Icon name="check" size={18} />} {children}
    </Link>
  );
}
