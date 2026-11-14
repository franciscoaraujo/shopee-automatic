import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { LinkButton } from '@/components/md';
import { effectiveInterval, formatInterval } from '@/lib/plans';
import { effectivePlan } from '@/server/plans';
import { describeSchedule, describeWhen, effectiveSchedule, isWithin, nextOpening } from '@/lib/schedule';
import { isOperational } from '@/server/accounts';
import { waState } from '@/server/integrations';
import { RANGES, failureStreaks, offersHistory, rangeKey, summary, workerHealth } from '@/server/metrics';
import { requireSession } from '@/server/session';
import { getSettings, readiness } from '@/server/settings';
import { SERIES } from '@/lib/channels';
import { RunNow, SeriesChart } from './charts';

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const dt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

function ago(iso: string | null) {
  if (!iso) return 'nunca';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'agora há pouco';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev && !cur) return null;
  if (!prev) return <span className="text-body-s text-on-surface-variant">sem período anterior para comparar</span>;
  const d = (cur - prev) / prev;
  const up = d >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-body-s ${up ? 'text-success' : 'text-error'}`}>
      <Icon name="trending_up" size={16} className={up ? '' : 'rotate-180 -scale-x-100'} />
      {up ? '+' : ''}{Math.round(d * 100)}% vs. período anterior
    </span>
  );
}

// Números de página compactos: 1 … 4 5 6 … 20
function pageList(page: number, pages: number): (number | '…')[] {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((p, i) => { if (i && p - sorted[i - 1] > 1) out.push('…'); out.push(p); });
  return out;
}

function Pagination({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  const btn = 'state-layer inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-full px-3 text-label-l';
  return (
    <nav aria-label="Páginas do histórico" className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/60 px-6 py-3">
      {page > 1
        ? <Link href={href(page - 1)} scroll={false} className={`${btn} text-primary`}><Icon name="arrow_back" size={18} /> Anterior</Link>
        : <span className={`${btn} text-on-surface-variant/40`} aria-disabled="true"><Icon name="arrow_back" size={18} /> Anterior</span>}
      <ol className="flex items-center gap-1">
        {pageList(page, pages).map((p, i) => (
          <li key={`${p}-${i}`}>
            {p === '…'
              ? <span className="px-1 text-on-surface-variant" aria-hidden>…</span>
              : <Link href={href(p)} scroll={false} aria-current={p === page ? 'page' : undefined} aria-label={`Página ${p}`}
                  className={`${btn} tabular-nums ${p === page ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant'}`}>{p}</Link>}
          </li>
        ))}
      </ol>
      {page < pages
        ? <Link href={href(page + 1)} scroll={false} className={`${btn} text-primary`}>Próxima <Icon name="arrow_forward" size={18} /></Link>
        : <span className={`${btn} text-on-surface-variant/40`} aria-disabled="true">Próxima <Icon name="arrow_forward" size={18} /></span>}
    </nav>
  );
}

type Health = { label: string; status: 'good' | 'warning' | 'critical' | 'off' | 'paused'; detail: string; href?: string };
const H_STYLE: Record<Health['status'], { icon: IconName; cls: string; text: string }> = {
  good: { icon: 'check_circle_fill', cls: 'text-success', text: 'OK' },
  warning: { icon: 'warning_fill', cls: 'text-[#9a6700]', text: 'Atenção' },
  critical: { icon: 'error_fill', cls: 'text-error', text: 'Problema' },
  off: { icon: 'pause_circle', cls: 'text-on-surface-variant', text: 'Desligado' },
  paused: { icon: 'schedule', cls: 'text-tertiary', text: 'Fora do horário' },
};

async function Dashboard({ searchParams }: { searchParams: PageProps<'/app'>['searchParams'] }) {
  await connection();
  const sp = await searchParams;
  const range = rangeKey(sp.range);
  const { account, user } = await requireSession();
  const pageNum = Number(typeof sp.pagina === 'string' ? sp.pagina : 1);
  const [s, settings, wa, worker, hist, failing] = await Promise.all([
    summary(account.id, range), getSettings(account.id), waState(account.id), workerHealth(), offersHistory(account.id, pageNum), failureStreaks(account.id),
  ]);
  // Mantém o período escolhido ao trocar de página
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (range !== '24h') q.set('range', range);
    if (p > 1) q.set('pagina', String(p));
    const qs = q.toString();
    return `/app${qs ? `?${qs}` : ''}#ofertas`;
  };
  const plan = await effectivePlan(account);
  const ready = readiness(settings, wa.state === 'open');
  const running = isOperational(account);
  const k = s.kpis;
  // Pode rodar se a Shopee está configurada e ao menos um canal consegue publicar
  const waUsable = settings.whatsappEnabled && wa.state === 'open' && !!settings.whatsappGroupJid;
  const tgUsable = settings.telegramEnabled && ready.items[2].ok;
  const canRun = running && ready.items[0].ok && (waUsable || tgUsable);

  const keys = (['whatsapp', 'telegram'] as const).filter((c) => (c === 'whatsapp' ? settings.whatsappEnabled : settings.telegramEnabled) || s.series.some((p) => p[c] > 0));
  const delivery = (c: { ok: number; total: number }) => (c.total ? c.ok / c.total : null);

  const lastRun = s.runs[0];
  const sched = effectiveSchedule(plan, settings);
  const inWindow = isWithin(sched);
  const opening = inWindow ? null : nextOpening(sched);
  const health: Health[] = [
    {
      label: 'Esteira',
      status: !running ? 'off' : !worker.ok ? 'critical' : !inWindow ? 'paused' : 'good',
      detail: !running ? 'Conta pausada'
        : !worker.ok ? 'Processador parado — suporte avisado'
        : !inWindow ? (opening ? `Volta ${describeWhen(opening)}` : 'Nenhum dia marcado')
        : account.next_run_at ? `Próxima rodada ${describeWhen(new Date(account.next_run_at))}` : 'Aguardando a primeira rodada',
      href: '/app/configuracoes#horario',
    },
    {
      label: 'Shopee',
      // Falha isolada da Shopee é normal e o sistema tenta de novo; só a sequência vira aviso
      status: !settings.shopeeAppId ? 'critical' : failing.shopee ? 'warning' : 'good',
      detail: !settings.shopeeAppId ? 'Credenciais não informadas' : failing.shopee ? 'Instável — seguimos tentando automaticamente' : lastRun ? `Última busca ${ago(lastRun.at)}` : 'Conectada',
      href: '/app/configuracoes#shopee',
    },
    {
      label: 'WhatsApp',
      status: !settings.whatsappEnabled ? 'off' : wa.state !== 'open' ? 'critical' : !settings.whatsappGroupJid || failing.whatsapp ? 'warning' : 'good',
      detail: !settings.whatsappEnabled ? 'Desativado' : wa.state !== 'open' ? 'Desconectado — leia o QR Code'
        : !settings.whatsappGroupJid ? 'Escolha o grupo'
        : failing.whatsapp ? 'Envios falhando — seguimos tentando automaticamente'
        : settings.whatsappGroupName ? `“${settings.whatsappGroupName}”` : 'Conectado',
      href: '/app/configuracoes#whatsapp',
    },
    {
      label: 'Telegram',
      status: !settings.telegramEnabled ? 'off' : !ready.items[2].ok ? 'critical' : failing.telegram ? 'warning' : 'good',
      detail: !settings.telegramEnabled ? 'Desativado' : !ready.items[2].ok ? 'Configuração incompleta'
        : failing.telegram ? 'Envios falhando — confira se o bot ainda é admin do canal' : settings.telegramChatId!,
      href: '/app/configuracoes#telegram',
    },
  ];

  return (
    <main className="mx-auto max-w-7xl px-5 py-8 md:py-10">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-display-s">Olá, {user.name.split(' ')[0]}</h1>
          <p className="mt-1 text-body-l text-on-surface-variant">
            Plano {plan.name} · <Link href="/app/configuracoes#frequencia" className="underline underline-offset-2">rodada a cada {formatInterval(effectiveInterval(plan, settings.runIntervalMin))}</Link> · até {plan.maxPerRun} ofertas por rodada
            {sched.enabled && <> · <Link href="/app/configuracoes#horario" className="underline underline-offset-2">{describeSchedule(sched).replace(/^D/, 'd')}</Link></>}
          </p>
        </div>
        <RunNow disabled={!canRun} />
      </div>

      {!ready.ready && running && (
        <div className="mt-6 flex flex-wrap items-center gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <Icon name="info" className="text-primary" />
          <p className="flex-1 text-body-l">Falta pouco: {ready.items.filter((i) => !i.ok).map((i) => i.label).join(' e ')} ainda {ready.items.filter((i) => !i.ok).length > 1 ? 'precisam' : 'precisa'} de configuração.</p>
          <LinkButton href="/app/configuracoes" size="md">Concluir configuração</LinkButton>
        </div>
      )}

      {/* Saúde */}
      <section aria-label="Saúde dos serviços" className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {health.map((h) => {
          const st = H_STYLE[h.status];
          const inner = (
            <>
              <div className="flex items-center justify-between">
                <span className="text-title-s">{h.label}</span>
                <span className={`inline-flex items-center gap-1 text-label-m ${st.cls}`}><Icon name={st.icon} size={18} /> {st.text}</span>
              </div>
              <p className="mt-2 truncate text-body-m text-on-surface-variant" title={h.detail}>{h.detail}</p>
            </>
          );
          return h.href
            ? <Link key={h.label} href={h.href} className="state-layer block rounded-lg border border-outline-variant/70 bg-surface-lowest p-4">{inner}</Link>
            : <div key={h.label} className="rounded-lg border border-outline-variant/70 bg-surface-lowest p-4">{inner}</div>;
        })}
      </section>

      {/* Período */}
      <div className="mt-10 flex flex-wrap items-center gap-2" role="group" aria-label="Período">
        {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => (
          <Link key={r} href={r === '24h' ? '/app' : `/app?range=${r}`} aria-current={r === range ? 'true' : undefined} scroll={false}
            className={`state-layer inline-flex h-8 items-center gap-1.5 rounded-sm border px-3 text-label-l ${r === range ? 'border-transparent bg-secondary-container text-on-secondary-container' : 'border-outline text-on-surface-variant'}`}>
            {r === range && <Icon name="check" size={18} />} {RANGES[r].label}
          </Link>
        ))}
      </div>

      {/* KPIs */}
      <section className="mt-5 grid gap-3 lg:grid-cols-[1.3fr_2fr]">
        <div className="rounded-xl bg-primary p-6 text-on-primary">
          <p className="text-label-l text-on-primary/80">Ofertas publicadas</p>
          <p className="mt-3 font-display text-[3.5rem] font-bold leading-none tracking-tight tabular-nums">{k.published}</p>
          <div className="mt-3 [&_*]:!text-on-primary/85"><Delta cur={k.published} prev={k.publishedPrev} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { l: 'Comissão potencial', v: brl(k.commission), sub: 'se cada oferta vender 1×' },
            { l: 'Entrega WhatsApp', v: delivery(k.channels.whatsapp) === null ? '—' : pct(delivery(k.channels.whatsapp)!), sub: `${k.channels.whatsapp.ok} de ${k.channels.whatsapp.total}` },
            { l: 'Entrega Telegram', v: delivery(k.channels.telegram) === null ? '—' : pct(delivery(k.channels.telegram)!), sub: `${k.channels.telegram.ok} de ${k.channels.telegram.total}` },
            { l: 'Rodadas', v: String(k.runs), sub: `${k.found} produtos analisados` },
          ].map((t) => (
            <div key={t.l} className="rounded-xl border border-outline-variant/70 bg-surface-lowest p-5">
              <p className="text-label-m text-on-surface-variant">{t.l}</p>
              <p className="mt-2 font-display text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums">{t.v}</p>
              <p className="mt-2 text-body-s text-on-surface-variant">{t.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Gráfico */}
      <section className="mt-3 rounded-xl border border-outline-variant/70 bg-surface-lowest p-6">
        <h2 className="text-title-l">Envios com sucesso</h2>
        <p className="mb-5 text-body-m text-on-surface-variant">Mensagens entregues por {s.unit === 'hour' ? 'hora' : 'dia'}{keys.length > 1 ? ' e canal' : ''}</p>
        {keys.length ? <SeriesChart data={s.series} unit={s.unit} keys={[...keys]} /> : <p className="py-10 text-center text-body-l text-on-surface-variant">Ative um canal para ver os envios aqui.</p>}
      </section>

      {/* Histórico de ofertas (paginado, independe do período acima) */}
      <section id="ofertas" className="mt-3 scroll-mt-24 rounded-xl border border-outline-variant/70 bg-surface-lowest">
        <div className="flex flex-wrap items-end justify-between gap-2 p-6 pb-3">
          <div>
            <h2 className="text-title-l">Histórico de ofertas</h2>
            <p className="text-body-m text-on-surface-variant">Todas as ofertas publicadas, da mais recente para a mais antiga</p>
          </div>
          {hist.total > 0 && (
            <p className="text-body-m tabular-nums text-on-surface-variant">
              {(hist.page - 1) * hist.perPage + 1}–{Math.min(hist.page * hist.perPage, hist.total)} de {hist.total.toLocaleString('pt-BR')}
            </p>
          )}
        </div>
        {hist.items.length === 0 ? (
          <p className="px-6 pb-8 pt-4 text-body-l text-on-surface-variant">Nenhuma oferta publicada ainda.</p>
        ) : (
          <ul className="divide-y divide-outline-variant/60">
            {hist.items.map((o) => (
              <li key={o.key} className="flex items-center gap-4 px-6 py-3">
                {o.imageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={o.imageUrl} alt="" width={48} height={48} loading="lazy" referrerPolicy="no-referrer" className="size-12 shrink-0 rounded-sm bg-surface-container object-cover" />
                  : <span className="size-12 shrink-0 rounded-sm bg-surface-container" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-l">{o.productName}</p>
                  <p className="text-body-s text-on-surface-variant">
                    {brl(o.price)} · comissão {pct(o.commissionRate)} ({brl(o.commission)}){o.keyword ? ` · “${o.keyword}”` : ''} · {dt.format(new Date(o.sentAt))}
                  </p>
                </div>
                <div className="hidden shrink-0 items-center gap-2 sm:flex">
                  {(['whatsapp', 'telegram'] as const).map((c) => o[c] === null ? null : (
                    <span key={c} className={`inline-flex h-6 items-center gap-1 rounded-xs px-2 text-label-s ${o[c] ? 'bg-success-container text-on-success-container' : 'bg-error-container text-on-error-container'}`}>
                      <Icon name={o[c] ? 'check' : 'close'} size={14} /> {SERIES[c].label}
                    </span>
                  ))}
                </div>
                {o.link && (
                  <a href={o.link} target="_blank" rel="noopener noreferrer" className="state-layer grid size-10 shrink-0 place-items-center rounded-full text-on-surface-variant" aria-label={`Abrir link de afiliado de ${o.productName}`}>
                    <Icon name="open_in_new" size={20} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
        {hist.pages > 1 && <Pagination page={hist.page} pages={hist.pages} href={(p) => pageHref(p)} />}
      </section>

      {/* Rodadas recentes (o detalhe técnico das falhas fica no /admin) */}
      <section className="mt-3 rounded-xl border border-outline-variant/70 bg-surface-lowest p-6">
        <h2 className="text-title-l">Rodadas recentes</h2>
        {s.runs.length === 0 ? <p className="mt-4 text-body-l text-on-surface-variant">Nenhuma rodada ainda.</p> : (
          <table className="mt-4 w-full text-left text-body-m">
            <thead className="text-label-m text-on-surface-variant"><tr><th className="py-2 font-semibold">Quando</th><th className="font-semibold">Palavra-chave</th><th className="text-right font-semibold">Analisados</th><th className="text-right font-semibold">Publicados</th></tr></thead>
            <tbody className="divide-y divide-outline-variant/50 tabular-nums">
              {s.runs.map((r) => (
                <tr key={r.id}>
                  <td className="py-2">{dt.format(new Date(r.at))}{r.trigger === 'manual' && <span className="ml-1.5 rounded-xs bg-surface-high px-1 text-label-s">manual</span>}</td>
                  <td className="max-w-60 truncate">
                    {r.keyword ?? 'geral'}
                    {r.error && <span className="text-on-surface-variant" title="A Shopee não respondeu nesta rodada; a próxima segue normalmente."> · Shopee não respondeu</span>}
                  </td>
                  <td className="text-right">{r.found}</td>
                  <td className="text-right">{r.published}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

export default function AppHome({ searchParams }: PageProps<'/app'>) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-5 py-12 text-body-l text-on-surface-variant">Carregando painel…</div>}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}
