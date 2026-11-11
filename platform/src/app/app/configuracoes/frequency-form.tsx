'use client';

// Ciclo de publicação: número grande + slider (de 5 em 5 min até 1 h, depois passos maiores).
// O slider só percorre os ciclos liberados pelo plano; o servidor valida de novo.
import { useActionState, useEffect, useRef, useState } from 'react';
import { FieldError } from '@/components/form-fields';
import { Icon } from '@/components/icons';
import { Button } from '@/components/md';
import { INTERVAL_OPTIONS, formatInterval } from '@/lib/plans';
import { saveSectionAction, type SaveState } from '../actions';
import { Slider } from './search-form';

export function FrequencyForm({ current, minimum, better: offers = [] }: { current: number; minimum: number; better?: { name: string; intervalMin: number }[] }) {
  // O mínimo pode vir de um plano/ajuste fora da lista (ex.: 12 min): ele entra como primeira opção
  const allowed = [...new Set([minimum, ...INTERVAL_OPTIONS.filter((m) => m >= minimum)])].filter((m) => m <= 240);
  const nearest = (v: number) => allowed.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), allowed[0]);

  const [state, action, pending] = useActionState<SaveState, FormData>(saveSectionAction.bind(null, 'frequency'), {});
  const [value, setValue] = useState(() => nearest(current));
  const [saved, setSaved] = useState(() => nearest(current));
  const submitted = useRef(value);
  useEffect(() => {
    if (!state.ok) return;
    const t = setTimeout(() => setSaved(submitted.current), 0);
    return () => clearTimeout(t);
  }, [state]);
  const dirty = value !== saved;
  const idx = allowed.indexOf(value);
  // Planos que liberam ciclos menores (para mostrar o que existe acima)
  const better = [...offers].sort((a, b) => a.intervalMin - b.intervalMin);

  return (
    <form action={action} onSubmit={() => { submitted.current = value; }} noValidate className="space-y-5">
      <input type="hidden" name="runIntervalMin" value={value} />
      <div>
        <label htmlFor="sl-interval" className="text-label-l text-on-surface-variant">Uma rodada a cada</label>
        <p className="mt-1 font-display text-[2.25rem] font-semibold leading-none tabular-nums">{formatInterval(value)}</p>
        <Slider id="sl-interval" label="Ciclo de publicação" value={idx} min={0} max={allowed.length - 1} step={1}
          onChange={(i) => setValue(allowed[i])} valueText={formatInterval(value)} />
        <p className="mt-1 flex justify-between text-body-s text-on-surface-variant">
          <span>{formatInterval(allowed[0])}</span><span>{formatInterval(allowed[allowed.length - 1])}</span>
        </p>
      </div>
      <p className="text-body-m text-on-surface-variant">
        Até <b className="text-on-surface">{Math.floor((24 * 60) / value)} rodadas por dia</b>, dentro do horário de envio.
        {better.length > 0 && <> Ciclos menores: {better.map((p) => `${p.name} a partir de ${formatInterval(p.intervalMin)}`).join(', ')}.</>}
      </p>
      <FieldError id="f-runIntervalMin-err">{state.errors?.runIntervalMin}</FieldError>
      <div className="flex flex-wrap items-center gap-3 border-t border-outline-variant/70 pt-5">
        <Button type="submit" disabled={pending || !dirty}>{pending ? 'Salvando…' : 'Salvar'}</Button>
        {dirty && !pending && <Button type="button" variant="text" onClick={() => setValue(saved)}>Descartar</Button>}
        <span className="ml-auto" role="status">
          {dirty
            ? <span className="inline-flex h-7 items-center rounded-sm bg-surface-high px-2.5 text-label-m text-on-surface-variant">Alteração não salva</span>
            : <span className="inline-flex h-7 items-center gap-1 rounded-sm bg-success-container px-2.5 text-label-m text-on-success-container"><Icon name="check" size={16} /> Salvo</span>}
        </span>
      </div>
    </form>
  );
}
