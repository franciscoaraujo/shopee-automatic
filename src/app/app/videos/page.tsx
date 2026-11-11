import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { LinkButton } from '@/components/md';
import { STATUS_GROUPS, statusGroup } from '@/lib/videos';
import { requireSession } from '@/server/session';
import { dashboard, filterOptions, listProviders, PERIODS, periodKey } from '@/server/videos/repo';
import { LiveRefresh } from '../live';
import { FilterBar } from './filters';
import { Card, dt, Empty, StatusChip, Thumb } from './ui';

async function Dashboard({ searchParams }: { searchParams: PageProps<'/app/videos'>['searchParams'] }) {
  await connection();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const { account } = await requireSession();
  const filters = { period: periodKey(str('periodo')), productId: str('produto'), category: str('categoria'), provider: str('provedor'), group: statusGroup(str('status')) };
  const [d, opts, providers] = await Promise.all([dashboard(account.id, filters), filterOptions(account.id), listProviders(account.id)]);
  const k = d.kpis;
  const ready = providers.some((p) => p.enabled && p.status === 'ok');

  const tiles: { label: string; value: number; icon: IconName; href: string; tone?: string }[] = [
    { label: 'Vídeos gerados', value: k.total, icon: 'movie', href: '/app/videos/galeria' },
    { label: 'Em processamento', value: k.processing, icon: 'autorenew', href: '/app/videos/galeria?status=processing', tone: 'text-tertiary' },
    { label: 'Aguardando avaliação', value: k.review, icon: 'rate_review', href: '/app/videos/galeria?status=review', tone: 'text-primary' },
    { label: 'Aprovados', value: k.approved, icon: 'thumb_up', href: '/app/videos/galeria?status=approved', tone: 'text-success' },
    { label: 'Rejeitados', value: k.rejected, icon: 'thumb_down', href: '/app/videos/galeria?status=rejected', tone: 'text-error' },
    { label: 'Produtos utilizados', value: k.products, icon: 'shopping_bag', href: '/app/videos/gerar' },
  ];

  return (
    <div className="space-y-3">
      {!ready && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <Icon name="info" className="text-primary" />
          <p className="flex-1 text-body-l">Para gerar vídeos, cadastre e teste um provedor de IA (Google Gemini ou xAI Grok).</p>
          <LinkButton href="/app/videos/ia" size="md">Configurar IA</LinkButton>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <FilterBar filters={[
          { name: 'periodo', label: 'Período de geração', allLabel: PERIODS['30d'].label, options: (Object.keys(PERIODS) as (keyof typeof PERIODS)[]).filter((p) => p !== '30d').map((p) => ({ value: p, label: PERIODS[p].label })) },
          { name: 'produto', label: 'Produto', allLabel: 'Todos os produtos', options: opts.products.map((p) => ({ value: p.id, label: p.name.length > 50 ? `${p.name.slice(0, 50)}…` : p.name })) },
          { name: 'categoria', label: 'Categoria', allLabel: 'Todas', options: opts.categories.map((c) => ({ value: c, label: c })) },
          { name: 'provedor', label: 'Provedor de IA', allLabel: 'Todos', options: opts.providers.map((p) => ({ value: p.type, label: p.label })) },
          { name: 'status', label: 'Status', allLabel: 'Todos', options: (Object.keys(STATUS_GROUPS) as (keyof typeof STATUS_GROUPS)[]).filter((g) => g !== 'all').map((g) => ({ value: g, label: STATUS_GROUPS[g].label })) },
        ]} />
        {k.processing > 0 && <LiveRefresh renderedAt={new Date().toISOString()} />}
      </div>

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="state-layer rounded-xl border border-outline-variant/70 bg-surface-lowest p-5">
            <p className="flex items-center justify-between text-label-m text-on-surface-variant">{t.label} <Icon name={t.icon} size={18} className={t.tone ?? ''} /></p>
            <p className="mt-3 font-display text-[2rem] font-semibold leading-none tracking-tight tabular-nums">{t.value}</p>
          </Link>
        ))}
      </section>

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Card title="Atividades recentes" description="Últimas gerações e mudanças de status no período filtrado"
          action={<LinkButton href="/app/videos/galeria" variant="text" size="md" trailingIcon="arrow_forward">Ver galeria</LinkButton>}>
          {d.recent.length === 0 ? (
            <Empty icon="movie" title="Nenhum vídeo ainda">Escolha produtos do Histórico de Ofertas em <Link href="/app/videos/gerar" className="text-primary underline">Gerar vídeos</Link>.</Empty>
          ) : (
            <ul className="-mx-6 divide-y divide-outline-variant/60">
              {d.recent.map((p) => (
                <li key={p.id}>
                  <Link href={`/app/videos/${p.id}`} className="state-layer flex items-center gap-4 px-6 py-3">
                    <Thumb p={p} className="w-12 shrink-0 rounded-sm [&_span]:hidden" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-l">{p.product.name}</p>
                      <p className="text-body-s text-on-surface-variant">{p.providerLabel} · {p.model} · v{p.version} · {dt.format(new Date(p.updatedAt))}</p>
                      {p.status === 'FAILED' && p.errorMessage && <p className="truncate text-body-s text-error">{p.errorMessage}</p>}
                    </div>
                    <StatusChip status={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Uso" description="Limite de gerações para evitar custos inesperados">
          <p className="font-display text-[2rem] font-semibold leading-none tabular-nums">{d.usage.last24h}<span className="text-title-m text-on-surface-variant"> / {d.usage.dailyLimit}</span></p>
          <p className="mt-2 text-body-m text-on-surface-variant">vídeos nas últimas 24 horas</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-container" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (d.usage.last24h / Math.max(1, d.usage.dailyLimit)) * 100)}%` }} />
          </div>
          {k.failed > 0 && (
            <Link href="/app/videos/galeria?status=failed" className="mt-6 flex items-center gap-2 text-body-m text-error underline-offset-2 hover:underline">
              <Icon name="error" size={18} /> {k.failed} {k.failed === 1 ? 'geração falhou' : 'gerações falharam'} no período
            </Link>
          )}
          <p className="mt-6 text-body-s text-on-surface-variant">Cada provedor cobra pela geração na sua própria conta de API.</p>
        </Card>
      </div>
    </div>
  );
}

export default function VideosHome({ searchParams }: PageProps<'/app/videos'>) {
  return (
    <Suspense fallback={<p className="py-12 text-body-l text-on-surface-variant">Carregando…</p>}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}
