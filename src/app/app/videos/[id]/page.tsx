import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Icon } from '@/components/icons';
import { CRITERIA, DECISIONS, FORMATS, LANGUAGES, NARRATIONS, STATUS_LABEL, STYLES, isReviewable, type Criterion } from '@/lib/videos';
import { requireSession } from '@/server/session';
import { getProject, listLogs, listReviews } from '@/server/videos/repo';
import { LiveRefresh } from '../../live';
import { CardActions } from '../galeria/card-actions';
import { brl, Card, dt, fmtBytes, mediaUrls, StatusChip } from '../ui';
import { ReviewForm } from './review-form';

export const metadata: Metadata = { title: 'Avaliação do vídeo' };

const PLAYER_ASPECT: Record<string, string> = { '9:16': 'aspect-[9/16] max-h-[78vh]', '16:9': 'aspect-video', '1:1': 'aspect-square max-h-[78vh]' };
const DECISION_STYLE = { APPROVED: 'text-success', REJECTED: 'text-error', REVISION_REQUESTED: 'text-tertiary' } as const;

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="contents"><dt className="text-on-surface-variant">{k}</dt><dd className="min-w-0 break-words">{children}</dd></div>;
}

async function Detail({ params }: { params: PageProps<'/app/videos/[id]'>['params'] }) {
  await connection();
  const { id } = await params;
  const { account } = await requireSession();
  const p = await getProject(account.id, id);
  if (!p) notFound();
  const [reviews, logs] = await Promise.all([listReviews(account.id, p.id), listLogs(account.id, p.id)]);
  const urls = mediaUrls(p);
  const running = ['PENDING', 'GENERATING', 'PROCESSING', 'GENERATED'].includes(p.status);
  const prod = p.product;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/app/videos/galeria" className="state-layer inline-flex h-9 items-center gap-1 rounded-full pl-2 pr-3 text-label-l text-primary"><Icon name="arrow_back" size={18} /> Galeria</Link>
        <h2 className="min-w-0 flex-1 truncate text-headline-s">{prod.name}</h2>
        <StatusChip status={p.status} />
        {running && <LiveRefresh renderedAt={new Date().toISOString()} />}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
        <div className="grid gap-3">
          <section className="overflow-hidden rounded-xl border border-outline-variant/70 bg-[#111]" id="player">
            {urls ? (
              <video controls preload="metadata" playsInline poster={urls.thumb ?? undefined} className={`mx-auto block w-full ${PLAYER_ASPECT[p.format]} bg-black object-contain`}>
                <source src={urls.play} type="video/mp4" />
                Seu navegador não reproduz MP4. <a href={urls.download}>Baixe o arquivo</a>.
              </video>
            ) : (
              <div className={`mx-auto grid w-full max-w-md place-items-center p-8 text-center text-white/90 ${PLAYER_ASPECT[p.format]}`}>
                <div>
                  <Icon name={p.status === 'FAILED' ? 'error' : 'hourglass_top'} size={40} className={p.status === 'FAILED' ? 'text-[#ffb4ab]' : 'animate-pulse'} />
                  <p className="mt-3 text-title-m">{STATUS_LABEL[p.status]}</p>
                  <p className="mt-1 text-body-m text-white/70">
                    {p.status === 'FAILED' ? p.errorMessage ?? 'A geração falhou.' : 'O vídeo aparece aqui quando a geração e o armazenamento terminarem. Esta página se atualiza sozinha.'}
                  </p>
                  {running && p.errorMessage && <p className="mt-2 text-body-s text-white/60">{p.errorMessage}</p>}
                </div>
              </div>
            )}
          </section>
          <section className="rounded-xl border border-outline-variant/70 bg-surface-lowest p-4">
            <CardActions id={p.id} status={p.status} hasVideo={!!p.video} download={urls?.download ?? null} />
          </section>

          <Card title="Geração">
            <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-body-m">
              <Row k="Provedor">{p.providerLabel}</Row>
              <Row k="Modelo"><code>{p.model}</code></Row>
              <Row k="Gerado em">{dt.format(new Date(p.createdAt))}</Row>
              <Row k="Formato">{FORMATS[p.format].label}</Row>
              <Row k="Duração">{p.video?.duration ? `${p.video.duration} s` : '—'} <span className="text-on-surface-variant">(pedido: {p.duration} s)</span></Row>
              <Row k="Resolução">{p.video?.resolution ?? '—'} <span className="text-on-surface-variant">(pedido: {p.options.resolution || 'padrão'})</span></Row>
              <Row k="Arquivo">{p.video ? `MP4 · ${fmtBytes(p.video.fileSize)}` : '—'}</Row>
              <Row k="Estilo">{STYLES[p.options.style]?.label ?? p.options.style}</Row>
              <Row k="Narração">{NARRATIONS[p.options.narration]?.label ?? p.options.narration} · {LANGUAGES[p.options.language] ?? p.options.language}</Row>
              <Row k="Versão">v{p.version}{p.parentProjectId && <> · <Link href={`/app/videos/${p.parentProjectId}`} className="text-primary underline">ver versão anterior</Link></>}</Row>
            </dl>
          </Card>
        </div>

        <div className="grid gap-3">
          {isReviewable(p.status) && p.video ? (
            <Card title="Avaliação" description="Notas de 1 a 5 (opcionais) e decisão.">
              <ReviewForm projectId={p.id} />
            </Card>
          ) : (
            <Card title="Avaliação"><p className="text-body-m text-on-surface-variant">A avaliação fica disponível quando o vídeo estiver gerado e armazenado.</p></Card>
          )}

          <Card title="Produto" description="Dados registrados no momento da geração">
            <div className="flex gap-4">
              {prod.imageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={prod.imageUrl} alt="" referrerPolicy="no-referrer" className="size-24 shrink-0 rounded-md bg-surface-container object-cover" />
                : null}
              <dl className="grid flex-1 grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-body-s">
                <Row k="Identificador">{prod.itemId}</Row>
                <Row k="Preço">{brl(prod.price)}</Row>
                <Row k="Preço original">{prod.originalPrice ? brl(prod.originalPrice) : 'não informado'}</Row>
                <Row k="Desconto">{prod.discountRate ? `${Math.round(prod.discountRate)}%` : 'não informado'}</Row>
                <Row k="Categoria">{prod.category ?? '—'}</Row>
                <Row k="Loja">{prod.shopName ?? 'não informado'}</Row>
                <Row k="Link do produto">{prod.productLink ? <a href={prod.productLink} target="_blank" rel="noopener noreferrer" className="text-primary underline">abrir</a> : 'não informado'}</Row>
                <Row k="Link de afiliado">{prod.affiliateLink ? <a href={prod.affiliateLink} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">{prod.affiliateLink}</a> : '—'}</Row>
              </dl>
            </div>
          </Card>

          <Card title="Prompt utilizado">
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-sm bg-surface-low p-3 font-mono text-body-s">{p.prompt}</pre>
          </Card>

          <Card title="Histórico de avaliações" description={reviews.length ? `${reviews.length} avaliação(ões)` : undefined}>
            {reviews.length === 0 ? <p className="text-body-m text-on-surface-variant">Nenhuma avaliação ainda.</p> : (
              <ol className="space-y-4">
                {reviews.map((r) => (
                  <li key={r.id} className="border-l-2 border-outline-variant pl-4">
                    <p className="text-body-m"><span className={`text-label-l ${DECISION_STYLE[r.decision]}`}>{DECISIONS[r.decision]}</span> · {r.reviewer ?? 'usuário removido'} · {dt.format(new Date(r.createdAt))}</p>
                    {Object.keys(r.ratings).length > 0 && (
                      <p className="mt-1 text-body-s text-on-surface-variant">
                        {(Object.keys(r.ratings) as Criterion[]).map((c) => `${CRITERIA[c]}: ${r.ratings[c]}/5`).join(' · ')}
                      </p>
                    )}
                    {r.comments && <p className="mt-1 whitespace-pre-wrap text-body-m">{r.comments}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <details className="rounded-xl border border-outline-variant/70 bg-surface-lowest">
            <summary className="state-layer cursor-pointer list-none rounded-xl p-6 text-title-m">Registro técnico ({logs.length})</summary>
            <ol className="space-y-3 px-6 pb-6 text-body-s">
              {logs.map((l) => (
                <li key={l.id} className="rounded-sm bg-surface-low p-3">
                  <p className="flex flex-wrap gap-x-3"><code className="text-label-m">{l.event}</code><span className="text-on-surface-variant">{dt.format(new Date(l.createdAt))}</span>{l.ms !== null && <span className="text-on-surface-variant">{(l.ms / 1000).toFixed(1)} s</span>}</p>
                  {l.error && <p className="mt-1 text-error">{l.error}</p>}
                  {(l.request || l.response) ? <pre className="mt-1 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-on-surface-variant">{JSON.stringify({ request: l.request ?? undefined, response: l.response ?? undefined }, null, 1)}</pre> : null}
                </li>
              ))}
            </ol>
          </details>
        </div>
      </div>
    </div>
  );
}

export default function VideoDetailPage({ params }: PageProps<'/app/videos/[id]'>) {
  return (
    <Suspense fallback={<p className="py-12 text-body-l text-on-surface-variant">Carregando…</p>}>
      <Detail params={params} />
    </Suspense>
  );
}
