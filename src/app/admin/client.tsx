'use client';

import { useActionState, useState, useTransition } from 'react';
import { TextField } from '@/components/form-fields';
import { Icon } from '@/components/icons';
import { Button } from '@/components/md';
import { ACCOUNT_STATUSES } from '@/lib/plans';
import { adminLogin, deleteAccountAction, resetPasswordAction, updateAccountAction } from './actions';

export function AdminLoginForm() {
  const [state, action, pending] = useActionState(adminLogin, {});
  return (
    <form action={action} className="mx-auto mt-10 max-w-sm space-y-5 rounded-xl bg-surface-lowest p-8 shadow-e1">
      <div>
        <h1 className="text-headline-s">Admin</h1>
        <p className="mt-1 text-body-m text-on-surface-variant">Área do dono da plataforma.</p>
      </div>
      <TextField label="Senha" name="password" type="password" autoComplete="current-password" autoFocus error={state.error} />
      <Button type="submit" className="w-full" disabled={pending}>{pending ? 'Entrando…' : 'Entrar'}</Button>
    </form>
  );
}

const TONE: Record<string, string> = {
  trial: 'bg-tertiary/10 text-tertiary',
  active: 'bg-success-container text-on-success-container',
  suspended: 'bg-error-container text-on-error-container',
  canceled: 'bg-surface-high text-on-surface-variant',
};

function AutoSelect({ id, name, value, options, className = '' }: { id: string; name: 'status' | 'plan'; value: string; options: readonly { value: string; label: string }[]; className?: string }) {
  return (
    <form action={updateAccountAction}>
      <input type="hidden" name="id" value={id} />
      <select
        name={name}
        defaultValue={value}
        aria-label={name === 'status' ? 'Situação' : 'Plano'}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`h-8 cursor-pointer rounded-sm border-0 px-2 text-label-l outline-none focus-visible:outline-2 focus-visible:outline-primary ${className}`}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </form>
  );
}

export const StatusSelect = ({ id, value }: { id: string; value: string }) => (
  <AutoSelect id={id} name="status" value={value} options={ACCOUNT_STATUSES} className={TONE[value] ?? ''} />
);
export const PlanSelect = ({ id, value, plans }: { id: string; value: string; plans: { id: string; name: string }[] }) => (
  <AutoSelect id={id} name="plan" value={value} className="bg-surface-container"
    options={(plans.some((p) => p.id === value) ? plans : [{ id: value, name: `${value} (removido)` }, ...plans]).map((p) => ({ value: p.id, label: p.name }))} />
);

export function ResetPassword({ id }: { id: string }) {
  const [res, setRes] = useState<{ email: string; password: string } | { error: string } | null>(null);
  const [pending, start] = useTransition();
  if (res && 'password' in res) {
    return (
      <div className="rounded-sm bg-tertiary/10 p-2 text-body-s">
        Nova senha de {res.email}: <code className="select-all rounded-xs bg-surface-lowest px-1 font-mono text-on-surface">{res.password}</code>
        <br />Envie ao cliente; ela não será mostrada de novo.
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => confirm('Gerar uma nova senha para este cliente? As sessões dele serão encerradas.') && start(async () => setRes(await resetPasswordAction(id)))}
      className="inline-flex items-center gap-1 text-label-m text-primary hover:underline"
    >
      <Icon name="key" size={16} /> {pending ? 'Gerando…' : 'Nova senha'}
      {res && 'error' in res && <span className="text-error"> {res.error}</span>}
    </button>
  );
}

export function DeleteAccount({ id, email }: { id: string; email: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const typed = prompt(`Excluir DEFINITIVAMENTE a conta e todos os dados?
Digite o e-mail do cliente para confirmar:
${email}`);
        if (typed === null) return;
        start(async () => { const r = await deleteAccountAction(id, typed); setErr(r.error ?? null); });
      }}
      className="mt-2 inline-flex items-center gap-1 text-label-m text-error hover:underline"
    >
      <Icon name="cancel" size={16} /> {pending ? 'Excluindo…' : 'Excluir conta'}
      {err && <span> · {err}</span>}
    </button>
  );
}
