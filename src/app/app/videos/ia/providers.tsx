'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { TextField } from '@/components/form-fields';
import { Icon } from '@/components/icons';
import { Button } from '@/components/md';
import { FORMATS, type ProviderCapabilities } from '@/lib/videos';
import type { ProviderView } from '@/server/videos/repo';
import {
  createProviderAction, deleteProviderAction, setDefaultProviderAction, testProviderAction, toggleProviderAction, updateProviderAction,
  type ActionResult,
} from '../actions';

export type ProviderType = { type: string; label: string; docsUrl: string; keyHelp: string; capabilities: ProviderCapabilities };

const dt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

function Feedback({ r }: { r: ActionResult | null }) {
  if (!r?.message) return null;
  return <p role="status" className={`text-body-m ${r.ok && !r.warning ? 'text-success' : 'text-error'}`}>{r.message}</p>;
}

export function AddProvider({ types }: { types: ProviderType[] }) {
  const router = useRouter();
  const [type, setType] = useState(types[0]?.type ?? '');
  const [res, setRes] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const [n, setN] = useState(0);
  const def = types.find((t) => t.type === type);

  return (
    <form
      key={n}
      action={(fd) => start(async () => {
        const r = await createProviderAction(fd);
        setRes(r);
        if (r.ok) { setN((x) => x + 1); router.refresh(); }
      })}
      className="grid gap-4"
    >
      <fieldset>
        <legend className="mb-2 text-label-l text-on-surface-variant">Provedor</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {types.map((t) => (
            <label key={t.type} className={`state-layer flex cursor-pointer items-start gap-3 rounded-md border p-4 ${type === t.type ? 'border-primary bg-primary/5' : 'border-outline-variant'}`}>
              <input type="radio" name="type" value={t.type} checked={type === t.type} onChange={() => setType(t.type)} className="mt-1 accent-[var(--md-primary)]" />
              <span>
                <span className="block text-title-s">{t.label}</span>
                <span className="block text-body-s text-on-surface-variant">
                  {t.capabilities.videoGeneration
                    ? `Gera vídeo · ${t.capabilities.models.map((m) => `${m.minDuration}–${m.maxDuration} s`).filter((v, i, a) => a.indexOf(v) === i).join(', ')} · ${[...new Set(t.capabilities.models.flatMap((m) => m.aspectRatios))].join(', ')}`
                    : `Sem geração de vídeo: ${t.capabilities.limitation}`}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nome (opcional)" name="name" maxLength={60} supporting={`Ex.: ${def?.label ?? ''} da loja`} error={res?.errors?.name} />
        <TextField label="API Key" name="apiKey" type="password" autoComplete="off" required error={res?.errors?.apiKey ?? res?.errors?.type}
          supporting="Guardada criptografada. Depois de salva, não é exibida de novo." />
      </div>
      {def && (
        <p className="flex items-start gap-2 text-body-s text-on-surface-variant">
          <Icon name="info" size={16} className="mt-0.5 shrink-0" />
          <span>{def.keyHelp} <a href={def.docsUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Documentação</a></span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" icon="add" disabled={pending}>{pending ? 'Salvando e testando…' : 'Adicionar e testar conexão'}</Button>
        <Feedback r={res} />
      </div>
    </form>
  );
}

const STATUS = {
  ok: { label: 'Conectado', cls: 'bg-success-container text-on-success-container', icon: 'check_circle' as const },
  error: { label: 'Falha na conexão', cls: 'bg-error-container text-on-error-container', icon: 'error' as const },
  unknown: { label: 'Não testado', cls: 'bg-surface-high text-on-surface-variant', icon: 'help' as const },
};

export function ProviderCard({ p, type }: { p: ProviderView; type?: ProviderType }) {
  const router = useRouter();
  const [res, setRes] = useState<ActionResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, after?: () => void) => start(async () => {
    const r = await fn();
    setRes(r);
    if (r.ok) after?.();
    router.refresh();
  });
  const st = STATUS[p.status];
  const caps = p.status === 'ok' ? p.models : [];
  const current = p.models.find((m) => m.id === p.defaultModel);

  return (
    <article className={`rounded-xl border bg-surface-lowest p-6 ${p.isDefault ? 'border-primary/60' : 'border-outline-variant/70'} ${p.enabled ? '' : 'opacity-75'}`}>
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 text-title-l">
            {p.name}
            {p.isDefault && <span className="inline-flex h-6 items-center gap-1 rounded-xs bg-primary px-2 text-label-s text-on-primary"><Icon name="star" size={14} /> Padrão</span>}
            {!p.enabled && <span className="inline-flex h-6 items-center rounded-xs bg-surface-high px-2 text-label-s text-on-surface-variant">Desativado</span>}
          </h3>
          <p className="mt-1 text-body-m text-on-surface-variant">{p.typeLabel} · chave {p.keyHint}</p>
        </div>
        <span className={`inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-label-m ${st.cls}`}><Icon name={st.icon} size={16} /> {st.label}</span>
      </header>

      <dl className="mt-5 grid gap-x-6 gap-y-3 text-body-m sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-label-m text-on-surface-variant">Modelo padrão</dt><dd>{current?.label ?? p.defaultModel ?? '—'}</dd></div>
        <div><dt className="text-label-m text-on-surface-variant">Geração de vídeo</dt><dd>{p.status === 'ok' ? (caps.length ? 'Disponível' : 'Indisponível para esta chave') : type?.capabilities.videoGeneration ? 'Suportada (teste a chave)' : 'Não suportada'}</dd></div>
        <div><dt className="text-label-m text-on-surface-variant">Limite de duração</dt><dd>{current ? `${current.minDuration} a ${current.maxDuration} s` : '—'}</dd></div>
        <div><dt className="text-label-m text-on-surface-variant">Última validação</dt><dd>{p.lastValidatedAt ? dt.format(new Date(p.lastValidatedAt)) : 'nunca'}</dd></div>
      </dl>

      {p.message && <p className={`mt-4 text-body-m ${p.status === 'error' ? 'text-error' : 'text-on-surface-variant'}`}>{p.message}</p>}

      {caps.length > 0 && (
        <details className="mt-4 rounded-md border border-outline-variant/60">
          <summary className="state-layer cursor-pointer list-none px-4 py-3 text-label-l text-primary">Modelos e capacidades ({caps.length})</summary>
          <div className="divide-y divide-outline-variant/60 border-t border-outline-variant/60">
            {caps.map((m) => (
              <div key={m.id} className="px-4 py-3 text-body-s">
                <p className="text-title-s">{m.label} <code className="ml-1 text-body-s text-on-surface-variant">{m.id}</code></p>
                <p className="mt-1 text-on-surface-variant">
                  {m.minDuration}–{m.maxDuration} s · {m.aspectRatios.map((a) => FORMATS[a].label).join(', ')} · {m.resolutions.join(', ')} · {m.audio ? 'com áudio' : 'sem áudio'} · {m.imageInput ? 'usa a foto do produto' : 'só texto'}
                </p>
                {m.notes.length > 0 && <ul className="mt-1 list-disc pl-5 text-on-surface-variant">{m.notes.map((x) => <li key={x}>{x}</li>)}</ul>}
              </div>
            ))}
          </div>
        </details>
      )}

      {editing && (
        <form className="mt-5 grid gap-4 rounded-md bg-surface-low p-4 sm:grid-cols-2" action={(fd) => run(() => updateProviderAction(p.id, fd), () => setEditing(false))}>
          <TextField label="Nome" name="name" defaultValue={p.name} maxLength={60} required error={res?.errors?.name} />
          <TextField label="Nova API Key (deixe vazio para manter)" name="apiKey" type="password" autoComplete="off" error={res?.errors?.apiKey} />
          <label className="flex flex-col gap-1 text-label-m text-on-surface-variant">
            Modelo padrão
            <select name="defaultModel" defaultValue={p.defaultModel ?? ''} disabled={!p.models.length}
              className="h-14 rounded-xs border border-outline bg-surface-lowest px-3 text-body-l text-on-surface">
              {!p.models.length && <option value="">Teste a conexão para listar os modelos</option>}
              {p.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            {res?.errors?.defaultModel && <span className="text-error">{res.errors.defaultModel}</span>}
          </label>
          <label className="flex flex-col gap-1 text-label-m text-on-surface-variant">
            Resolução padrão
            <select name="defaultResolution" defaultValue={String(p.settings.defaultResolution ?? '')}
              className="h-14 rounded-xs border border-outline bg-surface-lowest px-3 text-body-l text-on-surface">
              <option value="">Padrão do modelo</option>
              {[...new Set(p.models.flatMap((m) => m.resolutions))].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending}>Salvar</Button>
            <Button type="button" variant="text" onClick={() => setEditing(false)}>Cancelar</Button>
          </div>
        </form>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button type="button" variant="tonal" icon="sync" disabled={pending} onClick={() => run(() => testProviderAction(p.id))}>{pending ? 'Aguarde…' : 'Testar conexão'}</Button>
        {!editing && <Button type="button" variant="outlined" icon="edit" disabled={pending} onClick={() => setEditing(true)}>Editar</Button>}
        {!p.isDefault && p.enabled && <Button type="button" variant="text" icon="star" disabled={pending} onClick={() => run(() => setDefaultProviderAction(p.id))}>Tornar padrão</Button>}
        <Button type="button" variant="text" icon={p.enabled ? 'pause_circle' : 'play_arrow'} disabled={pending} onClick={() => run(() => toggleProviderAction(p.id, !p.enabled))}>
          {p.enabled ? 'Desativar' : 'Ativar'}
        </Button>
        <Button type="button" variant="text" icon="delete" className="!text-error" disabled={pending}
          onClick={() => { if (confirm(`Remover "${p.name}"? A chave será apagada. Os vídeos já gerados continuam na galeria.`)) run(() => deleteProviderAction(p.id)); }}>
          Remover
        </Button>
        <div className="basis-full"><Feedback r={res} /></div>
      </div>
    </article>
  );
}
