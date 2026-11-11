'use client';

// "O que publicar" — mesmo visual da propaganda: chips de palavras-chave, números grandes com
// sliders Material 3 e linhas com stepper. Os valores vão ao servidor por campos ocultos,
// pela mesma ação (saveSectionAction 'search') e com a mesma validação.
import { useActionState, useEffect, useMemo, useState } from 'react';
import { FieldError } from '@/components/form-fields';
import { Icon } from '@/components/icons';
import { Button } from '@/components/md';
import { SORT_OPTIONS, type PublicSettings } from '@/lib/settings-schema';
import { saveSectionAction, type SaveState } from '../actions';

const MAX_KEYWORDS = 20;
const splitKw = (s: string) => [...new Set(String(s ?? '').split(',').map((k) => k.trim()).filter(Boolean))];
const fmt = (n: number, d = 1) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d });

/* ------------------------------------------------------------------ Slider M3 */
export function Slider({ id, label, value, min, max, step, onChange, valueText }: {
  id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; valueText: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="relative mt-3 h-6">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={valueText}
        onChange={(e) => onChange(Number(e.target.value))}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      />
      {/* trilho inativo e ativo, com respiro em volta da alça */}
      <span aria-hidden className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-secondary-container" />
      <span aria-hidden className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary" style={{ width: `calc(${pct}% - 4px)` }} />
      <span
        aria-hidden
        className="absolute top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-primary/30 transition-[height] peer-hover:h-6 peer-focus-visible:h-6 peer-focus-visible:ring-4 peer-active:h-6"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ Stepper (− n +) */
function Stepper({ value, min, max, onChange, label, suffix }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; suffix?: string }) {
  const btn = 'state-layer grid size-9 place-items-center rounded-full border border-outline-variant text-on-surface-variant disabled:opacity-30';
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" className={btn} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Diminuir ${label}`}>
        <Icon name="remove" size={18} />
      </button>
      <span className="min-w-14 text-center text-title-m tabular-nums" aria-live="polite">{value}{suffix ? ` ${suffix}` : ''}</span>
      <button type="button" className={btn} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`Aumentar ${label}`}>
        <Icon name="add" size={18} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ formulário */
export function SearchPanel({ settings, maxPerRun }: { settings: PublicSettings; maxPerRun: number }) {
  const initial = useMemo(() => ({
    keywords: splitKw(settings.keywords),
    commission: +(settings.minCommissionRate * 100).toFixed(1),
    rating: settings.minRating,
    sortType: settings.sortType,
    perRun: Math.min(settings.maxPostsPerRun, maxPerRun),
    dedup: settings.dedupDays,
    subId: settings.subIdCampaign,
  }), [settings, maxPerRun]);

  const [kw, setKw] = useState<string[]>(initial.keywords);
  const [draft, setDraft] = useState('');
  const [commission, setCommission] = useState(initial.commission);
  const [rating, setRating] = useState(initial.rating);
  const [sortType, setSortType] = useState(initial.sortType);
  const [perRun, setPerRun] = useState(initial.perRun);
  const [dedup, setDedup] = useState(initial.dedup);
  const [subId, setSubId] = useState(initial.subId);
  const [kwMsg, setKwMsg] = useState<string | null>(null);

  const [state, action, pending] = useActionState<SaveState, FormData>(saveSectionAction.bind(null, 'search'), {});
  const [savedSnapshot, setSavedSnapshot] = useState(initial);

  const current = { keywords: kw, commission, rating, sortType, perRun, dedup, subId };
  const dirty = JSON.stringify(current) !== JSON.stringify(savedSnapshot);

  // Ao salvar com sucesso, o estado atual passa a ser a referência "salva"
  useEffect(() => {
    if (state.ok) {
      const t = setTimeout(() => setSavedSnapshot({ keywords: kw, commission, rating, sortType, perRun, dedup, subId }), 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao receber nova resposta do servidor
  }, [state]);

  const addKeywords = (raw: string) => {
    const novas = splitKw(raw).map((k) => k.slice(0, 60));
    if (!novas.length) return;
    const merged = [...kw];
    for (const k of novas) if (!merged.some((x) => x.toLowerCase() === k.toLowerCase())) merged.push(k);
    if (merged.length > MAX_KEYWORDS) { setKwMsg(`Máximo de ${MAX_KEYWORDS} palavras-chave`); return; }
    setKwMsg(null);
    setKw(merged);
    setDraft('');
  };

  const err = state.errors ?? {};

  return (
    <form action={action} noValidate className="space-y-8">
      {/* valores enviados ao servidor */}
      <input type="hidden" name="keywords" value={kw.join(', ')} />
      <input type="hidden" name="minCommissionRate" value={commission} />
      <input type="hidden" name="minRating" value={rating} />
      <input type="hidden" name="sortType" value={sortType} />
      <input type="hidden" name="maxPostsPerRun" value={perRun} />
      <input type="hidden" name="dedupDays" value={dedup} />

      {/* Palavras-chave */}
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-label-l text-on-surface-variant" id="kw-label">Palavras-chave em rodízio</p>
          <p className="text-body-s text-on-surface-variant">{kw.length ? `${kw.length} · uma por rodada` : 'Vazio = ofertas gerais'}</p>
        </div>
        <ul className="mt-3 flex flex-wrap gap-2" aria-labelledby="kw-label">
          {kw.map((k) => (
            <li key={k} className="inline-flex h-8 items-center gap-1 rounded-sm bg-secondary-container pl-3 pr-1 text-label-l text-on-secondary-container">
              {k}
              <button type="button" onClick={() => setKw(kw.filter((x) => x !== k))} className="state-layer grid size-6 place-items-center rounded-full" aria-label={`Remover ${k}`}>
                <Icon name="close" size={16} />
              </button>
            </li>
          ))}
          <li className="inline-flex h-8 items-center gap-1 rounded-sm border border-dashed border-outline pl-2 pr-1 focus-within:border-solid focus-within:border-primary">
            <Icon name="add" size={16} className="text-on-surface-variant" />
            <input
              value={draft}
              onChange={(e) => {
                const v = e.target.value;
                if (v.includes(',')) addKeywords(v); else setDraft(v);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addKeywords(draft); }
                if (e.key === 'Backspace' && !draft && kw.length) setKw(kw.slice(0, -1));
              }}
              onBlur={() => draft.trim() && addKeywords(draft)}
              placeholder="Adicionar palavra-chave"
              aria-label="Adicionar palavra-chave"
              maxLength={60}
              className="w-44 bg-transparent text-label-l text-on-surface outline-none placeholder:font-normal placeholder:text-on-surface-variant"
            />
          </li>
        </ul>
        <p className="mt-2 text-body-s text-on-surface-variant">Enter ou vírgula para adicionar. Cada rodada usa a próxima da lista.</p>
        {kwMsg && <FieldError id="kw-msg">{kwMsg}</FieldError>}
        <FieldError id="f-keywords-err">{err.keywords}</FieldError>
      </div>

      {/* Comissão e nota */}
      <div className="grid gap-8 sm:grid-cols-2">
        <div>
          <label htmlFor="sl-commission" className="text-label-l text-on-surface-variant">Comissão mínima</label>
          <p className="mt-1 font-display text-[2.25rem] font-semibold leading-none tabular-nums">{fmt(commission)}%</p>
          <Slider id="sl-commission" label="Comissão mínima" value={commission} min={0} max={30} step={0.5} onChange={setCommission} valueText={`${fmt(commission)} por cento`} />
          <p className="mt-1 flex justify-between text-body-s text-on-surface-variant"><span>0%</span><span>30%</span></p>
          <FieldError id="f-minCommissionRate-err">{err.minCommissionRate}</FieldError>
        </div>
        <div>
          <label htmlFor="sl-rating" className="text-label-l text-on-surface-variant">Nota mínima</label>
          <p className="mt-1 flex items-baseline gap-1.5 font-display text-[2.25rem] font-semibold leading-none tabular-nums">
            {fmt(rating)} <Icon name="star_fill" size={26} className="self-center text-[#e8a33d]" />
          </p>
          <Slider id="sl-rating" label="Nota mínima" value={rating} min={0} max={5} step={0.1} onChange={(v) => setRating(+v.toFixed(1))} valueText={`${fmt(rating)} de 5 estrelas`} />
          <p className="mt-1 flex justify-between text-body-s text-on-surface-variant"><span>qualquer</span><span>de 5 estrelas</span></p>
          <FieldError id="f-minRating-err">{err.minRating}</FieldError>
        </div>
      </div>

      {/* Demais regras, em linhas */}
      <div className="divide-y divide-outline-variant/70 border-y border-outline-variant/70">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
          <label htmlFor="f-sortType" className="text-body-l">Priorizar</label>
          <div className="relative">
            <select id="f-sortType" value={sortType} onChange={(e) => setSortType(Number(e.target.value))}
              className="h-10 cursor-pointer appearance-none rounded-sm bg-surface-container pl-3 pr-9 text-label-l text-on-surface outline-none focus-visible:outline-2 focus-visible:outline-primary">
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Icon name="keyboard_arrow_down" size={20} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          </div>
        </div>
        <div className="py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-body-l">Ofertas por rodada <span className="text-body-s text-on-surface-variant">(seu plano: até {maxPerRun})</span></span>
            <Stepper label="ofertas por rodada" value={perRun} min={1} max={maxPerRun} onChange={setPerRun} />
          </div>
          <FieldError id="f-maxPostsPerRun-err">{err.maxPostsPerRun}</FieldError>
        </div>
        <div className="py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-body-l">Não repetir produto por</span>
            <Stepper label="dias sem repetir" value={dedup} min={1} max={90} onChange={setDedup} suffix={dedup === 1 ? 'dia' : 'dias'} />
          </div>
          <FieldError id="f-dedupDays-err">{err.dedupDays}</FieldError>
        </div>
        <div className="py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="f-subId" className="text-body-l">
              SubID da campanha
              <span className="block text-body-s text-on-surface-variant">Identifica as vendas nos relatórios da Shopee</span>
            </label>
            <input id="f-subId" name="subIdCampaign" value={subId} onChange={(e) => setSubId(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 50))}
              className="h-10 w-48 rounded-sm bg-surface-container px-3 text-label-l text-on-surface outline-none focus-visible:outline-2 focus-visible:outline-primary" spellCheck={false} />
          </div>
          <FieldError id="f-subIdCampaign-err">{err.subIdCampaign}</FieldError>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !dirty}>{pending ? 'Salvando…' : 'Salvar'}</Button>
        {dirty && !pending && (
          <Button type="button" variant="text" onClick={() => {
            setKw(savedSnapshot.keywords); setCommission(savedSnapshot.commission); setRating(savedSnapshot.rating);
            setSortType(savedSnapshot.sortType); setPerRun(savedSnapshot.perRun); setDedup(savedSnapshot.dedup); setSubId(savedSnapshot.subId); setDraft('');
          }}>Descartar</Button>
        )}
        <span className="ml-auto" role="status">
          {dirty
            ? <span className="inline-flex h-7 items-center rounded-sm bg-surface-high px-2.5 text-label-m text-on-surface-variant">Alterações não salvas</span>
            : <span className="inline-flex h-7 items-center gap-1 rounded-sm bg-success-container px-2.5 text-label-m text-on-success-container"><Icon name="check" size={16} /> Salvo</span>}
        </span>
      </div>
      {err.form && <FieldError id="search-form-err">{err.form}</FieldError>}
    </form>
  );
}
