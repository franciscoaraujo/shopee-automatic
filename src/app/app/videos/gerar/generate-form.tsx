'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Icon } from '@/components/icons';
import { Button } from '@/components/md';
import { buildVideoPrompt } from '@/lib/video-prompt';
import {
  DEFAULT_FORMAT, FORMATS, LANGUAGES, MAX_PRODUCTS_PER_REQUEST, NARRATIONS, PRESET_DURATIONS, STYLES, validateRequest,
  type GenerationOptions, type Language, type ModelCapabilities, type Narration, type VideoFormat, type VideoStyle,
} from '@/lib/videos';
import type { ProductRow } from '@/server/videos/repo';
import { generateVideosAction, searchProductsAction, type ActionResult } from '../actions';

export type ProviderOption = {
  id: string; tier: 'premium' | 'economic'; name: string; typeLabel: string; isDefault: boolean; defaultModel: string | null;
  models: ModelCapabilities[]; defaultResolution: string | null;
  unavailable: string | null;                                        // motivo para não poder usar agora
  quota: { limit: number; used: number; remaining: number } | null;  // só no premium
};

const usd = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v);
type Page = { items: ProductRow[]; total: number; page: number; pages: number };

const brl = (v: number | null) => (v ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v) : '—');
const newKey = () => crypto.randomUUID();

function Step({ n, title, children, hint }: { n: number; title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-outline-variant/70 bg-surface-lowest p-6">
      <h2 className="flex items-center gap-3 text-title-l">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-label-l text-on-primary">{n}</span>{title}
      </h2>
      {hint && <p className="mt-1 pl-11 text-body-m text-on-surface-variant">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

const selectCls = 'h-12 w-full rounded-xs border border-outline bg-surface-lowest px-3 text-body-l text-on-surface outline-none focus:border-2 focus:border-primary disabled:opacity-50';

function Choice({ name, value, checked, disabled, onChange, title, sub }: { name: string; value: string; checked: boolean; disabled?: boolean; onChange: () => void; title: string; sub?: string }) {
  return (
    <label className={`flex items-start gap-3 rounded-md border p-3 ${disabled ? 'cursor-not-allowed opacity-50' : 'state-layer cursor-pointer'} ${checked ? 'border-primary bg-primary/5' : 'border-outline-variant'}`}>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} className="mt-1 accent-[var(--md-primary)]" />
      <span><span className="block text-label-l">{title}</span>{sub && <span className="block text-body-s text-on-surface-variant">{sub}</span>}</span>
    </label>
  );
}

export function GenerateForm({ providers, needsKey, categories, initial, preselected }: { providers: ProviderOption[]; needsKey: boolean; categories: string[]; initial: Page; preselected: ProductRow[] }) {
  /* -------- 1. produtos */
  const [page, setPage] = useState<Page>(initial);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<Map<string, ProductRow>>(() => new Map(preselected.map((p) => [p.itemId, p])));
  const [details, setDetails] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const first = useRef(true);

  const load = (p: number, s = search, c = category) => startLoading(async () => setPage(await searchProductsAction({ search: s, category: c, page: p })));
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => load(1), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category]);

  const toggle = (p: ProductRow) => setSelected((m) => {
    const next = new Map(m);
    if (next.has(p.itemId)) next.delete(p.itemId);
    else if (next.size < MAX_PRODUCTS_PER_REQUEST) next.set(p.itemId, p);
    return next;
  });

  /* -------- 2–8. configuração */
  // Começa pelo premium quando disponível; senão, pela chave padrão do cliente
  const [providerId, setProviderId] = useState(() =>
    (providers.find((p) => p.tier === 'premium' && !p.unavailable) ?? providers.find((p) => p.tier === 'economic' && p.isDefault) ?? providers.find((p) => !p.unavailable))?.id ?? '');
  const provider = providers.find((p) => p.id === providerId);
  const [modelId, setModelId] = useState(() => provider?.defaultModel ?? provider?.models[0]?.id ?? '');
  const caps = provider?.models.find((m) => m.id === modelId);
  const [format, setFormat] = useState<VideoFormat>(DEFAULT_FORMAT);
  const [duration, setDuration] = useState(10);
  const [custom, setCustom] = useState(false);
  const [resolution, setResolution] = useState(provider?.defaultResolution || caps?.defaultResolution || '720p');
  const [style, setStyle] = useState<VideoStyle>('showcase');
  // Padrão com voz quando o modelo gera áudio (a trilha sonora vem em todas as opções)
  const [narration, setNarration] = useState<Narration>(() => (caps?.audio ? 'female' : 'text'));
  const [language, setLanguage] = useState<Language>('pt-BR');
  const [voiceInstructions, setVoice] = useState('');
  const [extraInstructions, setExtra] = useState('');

  const chooseProvider = (id: string) => {
    setProviderId(id);
    const p = providers.find((x) => x.id === id);
    const m = p?.models.find((x) => x.id === p.defaultModel) ?? p?.models[0];
    setModelId(m?.id ?? '');
    if (m) adaptTo(m, p?.defaultResolution ?? null);
  };
  const chooseModel = (id: string) => {
    setModelId(id);
    const m = provider?.models.find((x) => x.id === id);
    if (m) adaptTo(m, provider?.defaultResolution ?? null);
  };
  // Ajusta as escolhas atuais aos limites do modelo novo
  const adaptTo = (m: ModelCapabilities, prefRes: string | null) => {
    if (!m.aspectRatios.includes(format)) setFormat(m.aspectRatios[0]);
    setDuration((d) => Math.min(Math.max(d, m.minDuration), m.maxDuration));
    setResolution(prefRes && m.resolutions.includes(prefRes) ? prefRes : m.defaultResolution);
    if (!m.audio && NARRATIONS[narration].needsAudio) setNarration('text');
  };

  const options: GenerationOptions = { style, narration, language, voiceInstructions, extraInstructions, resolution };
  const issues = validateRequest(caps, { duration, format, narration, resolution });

  /* -------- 9. prompts (automáticos até o usuário editar) */
  const [edited, setEdited] = useState<Record<string, string>>({});
  const products = useMemo(() => [...selected.values()], [selected]);
  const hasPremium = providers.some((p) => p.tier === 'premium');
  const overQuota = provider?.tier === 'premium' && !!provider.quota && products.length > provider.quota.remaining;
  const autoPrompt = (p: ProductRow) => buildVideoPrompt(p, options, format, duration);
  const promptOf = (p: ProductRow) => edited[p.itemId] ?? autoPrompt(p);

  /* -------- 10. envio */
  const [requestKey, setRequestKey] = useState(newKey);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [sending, startSending] = useTransition();
  const submit = () => startSending(async () => {
    const r = await generateVideosAction({
      requestKey, providerId, model: modelId, format, duration, options,
      items: products.map((p) => ({ productId: p.itemId, prompt: promptOf(p) })),
    });
    setResult(r);
    if (r.ok) { setRequestKey(newKey()); setSelected(new Map()); setEdited({}); }
  });

  if (!providers.some((p) => !p.unavailable) && needsKey) {
    return (
      <div className="rounded-xl border border-outline-variant/70 bg-surface-lowest p-8 text-center">
        <Icon name="tune" size={32} className="mx-auto text-primary" />
        <p className="mt-3 text-title-m">Cadastre sua chave do xAI Grok</p>
        <p className="mt-1 text-body-m text-on-surface-variant">Os vídeos são gerados com a sua chave do Grok e cobrados na sua conta xAI. Cadastre e teste a chave para começar.</p>
        <Link href="/app/videos/ia" className="mt-4 inline-block text-label-l text-primary underline">Ir para Configurações de IA</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="grid gap-3">
        <Step n={1} title="Produtos do Histórico de Ofertas" hint={`Selecione até ${MAX_PRODUCTS_PER_REQUEST}. Cada produto gera um vídeo.`}>
          <div className="flex flex-wrap gap-3">
            <label className="relative min-w-56 flex-1">
              <span className="sr-only">Pesquisar por nome</span>
              <Icon name="search" size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar por nome"
                className="h-12 w-full rounded-full border border-outline bg-surface-lowest pl-10 pr-4 text-body-l outline-none focus:border-2 focus:border-primary" />
            </label>
            <label className="w-56">
              <span className="sr-only">Categoria</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
                <option value="">Todas as categorias</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <p className="mt-2 text-body-s text-on-surface-variant">Categoria = palavra-chave da busca que encontrou o produto.</p>

          <ul className={`mt-4 divide-y divide-outline-variant/60 rounded-md border border-outline-variant/60 transition-opacity ${loading ? 'opacity-60' : ''}`}>
            {page.items.length === 0 && <li className="p-6 text-center text-body-m text-on-surface-variant">Nenhum produto encontrado.</li>}
            {page.items.map((p) => {
              const on = selected.has(p.itemId);
              const full = !on && selected.size >= MAX_PRODUCTS_PER_REQUEST;
              return (
                <li key={p.itemId}>
                  <div className="flex items-center gap-3 px-3 py-2">
                    <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(p)} aria-label={`Selecionar ${p.name}`} className="size-5 accent-[var(--md-primary)]" />
                    {p.imageUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.imageUrl} alt="" width={48} height={48} loading="lazy" referrerPolicy="no-referrer" className="size-12 shrink-0 rounded-sm bg-surface-container object-cover" />
                      : <span className="size-12 shrink-0 rounded-sm bg-surface-container" />}
                    <button type="button" onClick={() => toggle(p)} disabled={full} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-body-l">{p.name}</span>
                      <span className="block text-body-s text-on-surface-variant">
                        {brl(p.price)}{p.originalPrice ? ` · de ${brl(p.originalPrice)}` : ''}{p.category ? ` · ${p.category}` : ''}{p.videos ? ` · ${p.videos} vídeo(s)` : ''}
                      </span>
                    </button>
                    <button type="button" onClick={() => setDetails(details === p.itemId ? null : p.itemId)} className="state-layer rounded-full px-3 py-1.5 text-label-l text-primary" aria-expanded={details === p.itemId}>
                      Detalhes
                    </button>
                  </div>
                  {details === p.itemId && <ProductDetails p={p} />}
                </li>
              );
            })}
          </ul>
          {page.pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-body-m">
              <Button type="button" variant="text" icon="arrow_back" disabled={page.page <= 1 || loading} onClick={() => load(page.page - 1)}>Anterior</Button>
              <span className="tabular-nums text-on-surface-variant">Página {page.page} de {page.pages} · {page.total} produtos</span>
              <Button type="button" variant="text" trailingIcon="arrow_forward" disabled={page.page >= page.pages || loading} onClick={() => load(page.page + 1)}>Próxima</Button>
            </div>
          )}
        </Step>

        <Step n={2} title={hasPremium ? 'Tipo de vídeo' : 'Provedor de IA'} hint={hasPremium ? 'Premium usa a IA da plataforma (incluída no plano). Econômico usa a sua chave do Grok.' : 'Os vídeos usam a sua chave do xAI Grok e são cobrados na sua conta xAI.'}>
          <div className="grid gap-3 sm:grid-cols-2">
            {providers.map((p) => {
              const on = p.id === providerId;
              const off = !!p.unavailable;
              const minPrice = Math.min(...p.models.map((m) => m.usdPerSecond ?? Infinity));
              return (
                <label key={p.id} className={`flex items-start gap-3 rounded-md border p-4 ${off ? 'cursor-not-allowed opacity-60' : 'state-layer cursor-pointer'} ${on ? 'border-primary bg-primary/5' : 'border-outline-variant'}`}>
                  <input type="radio" name="provider" value={p.id} checked={on} disabled={off} onChange={() => chooseProvider(p.id)} className="mt-1 accent-[var(--md-primary)]" />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-title-s">
                      {p.tier === 'premium' ? 'Premium' : hasPremium ? 'Econômico' : p.name}
                      <span className={`rounded-xs px-1.5 text-label-s ${p.tier === 'premium' ? 'bg-primary text-on-primary' : 'bg-secondary-container text-on-secondary-container'}`}>{p.typeLabel}</span>
                    </span>
                    <span className="mt-1 block text-body-s text-on-surface-variant">
                      {p.tier === 'premium'
                        ? (p.quota ? `Incluído no seu plano · ${p.quota.remaining} de ${p.quota.limit} restantes este mês` : 'Incluído no seu plano')
                        : `Sua chave “${p.name}” · cobrado na sua conta xAI${Number.isFinite(minPrice) ? ` · a partir de ${usd(minPrice)}/s` : ''}`}
                    </span>
                    {p.unavailable && <span className="mt-1 block text-body-s text-error">{p.unavailable}</span>}
                  </span>
                </label>
              );
            })}
            {needsKey && (
              <Link href="/app/videos/ia" className="state-layer flex items-start gap-3 rounded-md border border-dashed border-outline p-4">
                <Icon name="add_circle" className="mt-0.5 text-primary" />
                <span>
                  <span className="block text-title-s">{hasPremium ? 'Econômico · xAI Grok' : 'Cadastrar chave do xAI Grok'}</span>
                  <span className="block text-body-s text-on-surface-variant">Cadastre sua chave do Grok para gerar vídeos mais baratos, cobrados na sua conta xAI.</span>
                </span>
              </Link>
            )}
          </div>
          {provider && provider.models.length > 1 && (
            <label className="mt-4 flex max-w-md flex-col gap-1 text-label-m text-on-surface-variant">Modelo
              <select value={modelId} onChange={(e) => chooseModel(e.target.value)} className={selectCls}>
                {provider.models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.usdPerSecond ? ` · ${usd(m.usdPerSecond)}/s` : ''}</option>)}
              </select>
            </label>
          )}
          {caps && caps.notes.length > 0 && (
            <ul className="mt-4 space-y-1 text-body-s text-on-surface-variant">
              {caps.notes.map((x) => <li key={x} className="flex gap-2"><Icon name="info" size={16} className="mt-0.5 shrink-0" /> {x}</li>)}
            </ul>
          )}
        </Step>

        <Step n={3} title="Formato e duração">
          <fieldset>
            <legend className="mb-2 text-label-l text-on-surface-variant">Formato</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(FORMATS) as VideoFormat[]).map((f) => {
                const ok = !!caps?.aspectRatios.includes(f);
                return <Choice key={f} name="format" value={f} checked={format === f} disabled={!ok} onChange={() => setFormat(f)} title={FORMATS[f].label} sub={ok ? FORMATS[f].hint : 'Não suportado por este modelo'} />;
              })}
            </div>
          </fieldset>
          <fieldset className="mt-5">
            <legend className="mb-2 text-label-l text-on-surface-variant">Duração {caps && <span className="text-body-s">(este modelo: {caps.minDuration} a {caps.maxDuration} s)</span>}</legend>
            <div className="flex flex-wrap gap-2">
              {PRESET_DURATIONS.map((d) => {
                const ok = !!caps && d >= caps.minDuration && d <= caps.maxDuration;
                const on = !custom && duration === d;
                return (
                  <button key={d} type="button" disabled={!ok} onClick={() => { setCustom(false); setDuration(d); }} title={ok ? undefined : `Acima do limite do modelo (${caps?.maxDuration} s)`}
                    className={`h-10 rounded-sm border px-4 text-label-l disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'border-transparent bg-secondary-container text-on-secondary-container' : 'border-outline text-on-surface-variant'}`}>
                    {d} s
                  </button>
                );
              })}
              <button type="button" onClick={() => setCustom(true)}
                className={`h-10 rounded-sm border px-4 text-label-l ${custom ? 'border-transparent bg-secondary-container text-on-secondary-container' : 'border-outline text-on-surface-variant'}`}>
                Personalizada
              </button>
              {custom && caps && (
                <label className="inline-flex items-center gap-2 text-body-m">
                  <input type="number" min={caps.minDuration} max={caps.maxDuration} step={1} value={duration}
                    onChange={(e) => setDuration(Math.round(Number(e.target.value)))} className="h-10 w-20 rounded-xs border border-outline bg-surface-lowest px-3 text-body-l" />
                  segundos
                </label>
              )}
            </div>
            {caps && caps.maxDuration < 20 && <p className="mt-2 text-body-s text-on-surface-variant">20 e 30 segundos ficam indisponíveis: nenhum modelo deste provedor gera vídeos tão longos numa única chamada.</p>}
          </fieldset>
          <label className="mt-5 flex max-w-56 flex-col gap-1 text-label-m text-on-surface-variant">Resolução
            <select value={resolution} onChange={(e) => setResolution(e.target.value)} className={selectCls}>
              {caps?.resolutions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </Step>

        <Step n={4} title="Estilo visual">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(STYLES) as VideoStyle[]).map((s) => <Choice key={s} name="style" value={s} checked={style === s} onChange={() => setStyle(s)} title={STYLES[s].label} />)}
          </div>
        </Step>

        <Step n={5} title="Narração" hint={caps && !caps.audio ? 'Este modelo não gera áudio: só "Sem narração" e "Texto na tela".' : undefined}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(NARRATIONS) as Narration[]).map((k) => (
              <Choice key={k} name="narration" value={k} checked={narration === k} disabled={NARRATIONS[k].needsAudio && !caps?.audio} onChange={() => setNarration(k)} title={NARRATIONS[k].label} />
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-label-m text-on-surface-variant">Idioma
              <select value={language} onChange={(e) => setLanguage(e.target.value as Language)} className={selectCls}>
                {(Object.keys(LANGUAGES) as Language[]).map((l) => <option key={l} value={l}>{LANGUAGES[l]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-label-m text-on-surface-variant">Instruções de voz (opcional)
              <input value={voiceInstructions} onChange={(e) => setVoice(e.target.value)} maxLength={300} disabled={!NARRATIONS[narration].needsAudio}
                placeholder="Ex.: tom animado, ritmo rápido" className={`${selectCls} placeholder:text-on-surface-variant/60`} />
            </label>
          </div>
        </Step>

        <Step n={6} title="Instruções adicionais" hint="Opcional. Entram no fim do prompt.">
          <textarea value={extraInstructions} onChange={(e) => setExtra(e.target.value)} maxLength={1000} rows={3}
            placeholder="Ex.: fundo claro, destacar o preço no final"
            className="w-full rounded-xs border border-outline bg-surface-lowest p-3 text-body-l outline-none placeholder:text-on-surface-variant/60 focus:border-2 focus:border-primary" />
        </Step>

        <Step n={7} title="Prompt de geração" hint="Gerado a partir dos dados do produto. Você pode editar antes de enviar.">
          {products.length === 0 ? (
            <p className="text-body-m text-on-surface-variant">Selecione um produto para ver o prompt.</p>
          ) : (
            <div className="grid gap-4">
              {products.map((p) => (
                <div key={p.itemId}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="truncate text-label-l">{p.name}</p>
                    {edited[p.itemId] !== undefined && (
                      <button type="button" onClick={() => setEdited((x) => { const next = { ...x }; delete next[p.itemId]; return next; })} className="shrink-0 text-label-m text-primary underline">Restaurar automático</button>
                    )}
                  </div>
                  <textarea value={promptOf(p)} onChange={(e) => setEdited((x) => ({ ...x, [p.itemId]: e.target.value }))} rows={10} maxLength={8000}
                    className="w-full rounded-xs border border-outline bg-surface-low p-3 font-mono text-body-s outline-none focus:border-2 focus:border-primary" />
                </div>
              ))}
            </div>
          )}
        </Step>
      </div>

      <aside className="grid gap-3 lg:sticky lg:top-24">
        <section className="rounded-xl border border-outline-variant/70 bg-surface-lowest p-6">
          <h2 className="text-title-l">Resumo</h2>
          <dl className="mt-4 space-y-2 text-body-m">
            <div className="flex justify-between gap-3"><dt className="text-on-surface-variant">Produtos</dt><dd className="tabular-nums">{selected.size} / {MAX_PRODUCTS_PER_REQUEST}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-on-surface-variant">Modelo</dt><dd className="truncate text-right">{caps?.label ?? '—'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-on-surface-variant">Formato</dt><dd>{FORMATS[format].label}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-on-surface-variant">Duração</dt><dd>{duration} s · {resolution}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-on-surface-variant">Estilo</dt><dd className="text-right">{STYLES[style].label}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-on-surface-variant">Narração</dt><dd>{NARRATIONS[narration].label}</dd></div>
            {provider?.tier === 'premium' && provider.quota && (
              <div className="flex justify-between gap-3"><dt className="text-on-surface-variant">Cota premium</dt><dd className="tabular-nums">usa {Math.max(products.length, 1)} de {provider.quota.remaining} restantes</dd></div>
            )}
            {provider?.tier === 'economic' && caps?.usdPerSecond && (
              <div className="flex justify-between gap-3"><dt className="text-on-surface-variant">Custo estimado (xAI)</dt><dd className="tabular-nums">{usd(caps.usdPerSecond * duration * Math.max(products.length, 1))}</dd></div>
            )}
          </dl>
          {products.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-outline-variant/60 pt-4">
              {products.map((p) => (
                <li key={p.itemId} className="flex items-center gap-2 text-body-s">
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <button type="button" onClick={() => toggle(p)} aria-label={`Remover ${p.name}`} className="state-layer grid size-7 place-items-center rounded-full text-on-surface-variant"><Icon name="close" size={16} /></button>
                </li>
              ))}
            </ul>
          )}
          {issues.length > 0 && <ul className="mt-4 space-y-1 text-body-s text-error">{issues.map((i) => <li key={i.field}>{i.message}</li>)}</ul>}
          {overQuota && <p className="mt-4 text-body-s text-error">Sua cota premium tem {provider!.quota!.remaining} vídeo(s) restante(s) este mês. Remova produtos ou use a opção econômica.</p>}
          <Button type="button" icon="movie" className="mt-5 w-full" disabled={sending || !products.length || issues.length > 0 || overQuota || !provider || !!provider.unavailable} onClick={submit}>
            {sending ? 'Enviando…' : `Gerar ${products.length > 1 ? `${products.length} vídeos` : 'vídeo'}`}
          </Button>
          <p className="mt-3 text-body-s text-on-surface-variant">A geração é cobrada pelo provedor. Os vídeos ficam só na galeria interna; nada é publicado.</p>
          {result && (
            <div role="status" className={`mt-4 rounded-md p-3 text-body-m ${result.ok ? 'bg-success-container text-on-success-container' : 'bg-error-container text-on-error-container'}`}>
              {result.message}
              {result.ok && <Link href="/app/videos/galeria?status=processing" className="mt-1 block text-label-l underline">Acompanhar na galeria</Link>}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function ProductDetails({ p }: { p: ProductRow }) {
  const rows: [string, React.ReactNode][] = [
    ['Identificador', p.itemId],
    ['Preço atual', brl(p.price)],
    ['Preço original', p.originalPrice ? brl(p.originalPrice) : 'não informado'],
    ['Desconto', p.discountRate ? `${Math.round(p.discountRate)}%` : 'não informado'],
    ['Categoria', p.category ?? '—'],
    ['Loja', p.shopName ?? 'não informado'],
    ['Descrição', 'não fornecida pela API de afiliados da Shopee'],
    ['Imagens', p.imageUrl ? '1 imagem principal (fornecida pela API de afiliados)' : 'nenhuma'],
    ['Link do produto', p.productLink ? <a href={p.productLink} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">{p.productLink}</a> : 'não informado'],
    ['Link de afiliado', p.affiliateLink ? <a href={p.affiliateLink} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">{p.affiliateLink}</a> : '—'],
  ];
  return (
    <div className="grid gap-4 bg-surface-low px-4 py-4 sm:grid-cols-[160px_1fr]">
      {p.imageUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={p.imageUrl} alt={p.name} referrerPolicy="no-referrer" className="aspect-square w-40 rounded-md bg-surface-container object-cover" />
        : <span className="aspect-square w-40 rounded-md bg-surface-container" />}
      <dl className="grid gap-x-4 gap-y-1 text-body-s sm:grid-cols-[130px_1fr]">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-on-surface-variant">{k}</dt><dd className="min-w-0">{v}</dd></div>)}
      </dl>
    </div>
  );
}
