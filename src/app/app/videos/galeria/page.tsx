import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Icon } from '@/components/icons';
import { LinkButton } from '@/components/md';
import { FORMATS, STATUS_GROUPS, statusGroup, type StatusGroup } from '@/lib/videos';
import { requireSession } from '@/server/session';
import { listProjects } from '@/server/videos/repo';
import { LiveRefresh } from '../../live';
import { brl, dt, Empty, FilterChip, mediaUrls, StatusChip, Thumb } from '../ui';
import { CardActions } from './card-actions';

export const metadata: Metadata = { title: 'Galeria de Vídeos' };

async function Gallery({ searchParams }: { searchParams: PageProps<'/app/videos/galeria'>['searchParams'] }) {
  await connection();
  const sp = await searchParams;
  const group = statusGroup(sp.status);
  const pageNum = Number(typeof sp.pagina === 'string' ? sp.pagina : 1);
  const { account } = await requireSession();
  const list = await listProjects(account.id, { group, page: pageNum, period: 'all' });
  const href = (g: StatusGroup, p = 1) => {
    const q = new URLSearchParams();
    if (g !== 'all') q.set('status', g);
    if (p > 1) q.set('pagina', String(p));
    return `/app/videos/galeria${q.size ? `?${q}` : ''}`;
  };
  const processing = list.items.some((p) => ['PENDING', 'GENERATING', 'PROCESSING', 'GENERATED'].includes(p.status));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por status">
        {(Object.keys(STATUS_GROUPS) as StatusGroup[]).map((g) => <FilterChip key={g} href={href(g)} active={g === group}>{STATUS_GROUPS[g].label}</FilterChip>)}
        <div className="ml-auto flex items-center gap-4">
          {processing && <LiveRefresh renderedAt={new Date().toISOString()} />}
          <span className="text-body-m tabular-nums text-on-surface-variant">{list.total} vídeo(s)</span>
        </div>
      </div>

      {list.items.length === 0 ? (
        <div className="mt-5 rounded-xl border border-outline-variant/70 bg-surface-lowest">
          <Empty icon="video_library" title={group === 'all' ? 'A galeria está vazia' : `Nenhum vídeo em "${STATUS_GROUPS[group].label}"`}>
            <LinkButton href="/app/videos/gerar" size="md" className="mt-3">Gerar vídeos</LinkButton>
          </Empty>
        </div>
      ) : (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.items.map((p) => {
            const urls = mediaUrls(p);
            return (
              <li key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-outline-variant/70 bg-surface-lowest">
                <Link href={`/app/videos/${p.id}`} aria-label={`Reproduzir e avaliar: ${p.product.name}`} className="block bg-surface-container">
                  <Thumb p={p} className="mx-auto max-h-80" />
                </Link>
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/app/videos/${p.id}`} className="line-clamp-2 text-title-s hover:underline">{p.product.name}</Link>
                    <StatusChip status={p.status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-body-s">
                    <div><dt className="text-on-surface-variant">Preço na geração</dt><dd className="tabular-nums">{brl(p.product.price)}</dd></div>
                    <div><dt className="text-on-surface-variant">Provedor</dt><dd className="truncate">{p.providerLabel}</dd></div>
                    <div><dt className="text-on-surface-variant">Modelo</dt><dd className="truncate" title={p.model}>{p.model}</dd></div>
                    <div><dt className="text-on-surface-variant">Gerado em</dt><dd className="tabular-nums">{dt.format(new Date(p.createdAt))}</dd></div>
                    <div><dt className="text-on-surface-variant">Duração</dt><dd>{p.video?.duration ? `${p.video.duration} s` : `${p.duration} s (pedido)`}</dd></div>
                    <div><dt className="text-on-surface-variant">Formato</dt><dd>{FORMATS[p.format].label}{p.version > 1 ? ` · v${p.version}` : ''}</dd></div>
                  </dl>
                  {p.status === 'FAILED' && p.errorMessage && <p className="mt-2 line-clamp-2 text-body-s text-error" title={p.errorMessage}>{p.errorMessage}</p>}
                  <details className="mt-3 text-body-s">
                    <summary className="cursor-pointer text-label-l text-primary">Ver prompt</summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-sm bg-surface-low p-2 font-mono text-[11px]">{p.prompt}</pre>
                  </details>
                  <div className="mt-auto pt-3">
                    <div className="mb-1 flex gap-1">
                      <Link href={`/app/videos/${p.id}`} className="state-layer inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-label-l text-primary">
                        <Icon name={p.video ? 'play_arrow' : 'info'} size={18} /> {p.video ? 'Reproduzir e avaliar' : 'Detalhes'}
                      </Link>
                    </div>
                    <CardActions id={p.id} status={p.status} hasVideo={!!p.video} download={urls?.download ?? null} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {list.pages > 1 && (
        <nav aria-label="Páginas" className="mt-5 flex items-center justify-between">
          {list.page > 1 ? <LinkButton href={href(group, list.page - 1)} variant="text" icon="arrow_back">Anterior</LinkButton> : <span />}
          <span className="text-body-m tabular-nums text-on-surface-variant">Página {list.page} de {list.pages}</span>
          {list.page < list.pages ? <LinkButton href={href(group, list.page + 1)} variant="text" trailingIcon="arrow_forward">Próxima</LinkButton> : <span />}
        </nav>
      )}
    </div>
  );
}

export default function GalleryPage({ searchParams }: PageProps<'/app/videos/galeria'>) {
  return (
    <Suspense fallback={<p className="py-12 text-body-l text-on-surface-variant">Carregando…</p>}>
      <Gallery searchParams={searchParams} />
    </Suspense>
  );
}
