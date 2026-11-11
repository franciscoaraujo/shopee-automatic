'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/icons';
import { Button } from '@/components/md';
import { CRITERIA, type Criterion, type Decision } from '@/lib/videos';
import { reviewAction, type ActionResult } from '../actions';

function Stars({ name, label }: { name: Criterion; label: string }) {
  const [v, setV] = useState(0);
  return (
    <fieldset className="flex flex-wrap items-center justify-between gap-2 py-2">
      <legend className="float-left text-body-m">{label}</legend>
      <div className="flex items-center gap-0.5" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer" title={`${n} de 5`}>
            <input type="radio" name={name} value={n} checked={v === n} onChange={() => setV(n)} className="peer sr-only" />
            <Icon name="star" size={26} className={`rounded-sm peer-focus-visible:outline-2 peer-focus-visible:outline-primary ${n <= v ? 'text-[#c98a00]' : 'text-outline-variant'}`} label={`${n}`} />
          </label>
        ))}
        {v > 0 && <button type="button" onClick={() => setV(0)} className="ml-1 text-label-s text-on-surface-variant underline">limpar</button>}
      </div>
    </fieldset>
  );
}

export function ReviewForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [res, setRes] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const [n, setN] = useState(0);

  const submit = (decision: Decision) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const form = e.currentTarget.form!;
    const fd = new FormData(form);
    fd.set('decision', decision);
    start(async () => {
      const r = await reviewAction(projectId, fd);
      setRes(r);
      if (r.ok) {
        setN((x) => x + 1);
        if (r.id) router.push(`/app/videos/${r.id}`);
        else router.refresh();
      }
    });
  };

  return (
    <form key={n} onSubmit={(e) => e.preventDefault()}>
      <div className="divide-y divide-outline-variant/50">
        {(Object.keys(CRITERIA) as Criterion[]).map((c) => <Stars key={c} name={c} label={CRITERIA[c]} />)}
      </div>
      <label className="mt-4 block">
        <span className="text-label-l text-on-surface-variant">Observações</span>
        <textarea name="comments" rows={3} maxLength={4000} placeholder="O que está bom, o que precisa mudar…"
          className="mt-1 w-full rounded-xs border border-outline bg-surface-lowest p-3 text-body-l outline-none placeholder:text-on-surface-variant/60 focus:border-2 focus:border-primary" />
      </label>
      {res?.errors?.comments && <p className="mt-1 text-body-s text-error">{res.errors.comments}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" icon="thumb_up" disabled={pending} onClick={submit('APPROVED')}>Aprovar vídeo</Button>
        <Button type="button" variant="outlined" icon="thumb_down" disabled={pending} onClick={submit('REJECTED')} className="!text-error">Rejeitar vídeo</Button>
        <Button type="button" variant="tonal" icon="autorenew" disabled={pending} onClick={submit('REVISION_REQUESTED')}>Solicitar nova versão</Button>
      </div>
      <p className="mt-3 text-body-s text-on-surface-variant">
        Aprovar é uma marcação interna: nada é publicado. &quot;Solicitar nova versão&quot; rejeita este vídeo e gera outro com as observações acrescentadas ao prompt.
      </p>
      {res?.message && <p role="status" className={`mt-3 text-body-m ${res.ok ? 'text-success' : 'text-error'}`}>{res.message}</p>}
    </form>
  );
}
