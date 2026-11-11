'use client';

import { useActionState } from 'react';
import { TextField } from '@/components/form-fields';
import { Icon } from '@/components/icons';
import { Button } from '@/components/md';
import { changePasswordAction, type SaveState } from '../actions';

export function PasswordForm() {
  const [state, action, pending] = useActionState<SaveState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="mt-5 space-y-4">
      <TextField label="Senha atual" name="current" type="password" autoComplete="current-password" error={state.errors?.current} />
      <TextField label="Nova senha" name="next" type="password" autoComplete="new-password" supporting="Mínimo de 10 caracteres." error={state.errors?.next} />
      {state.errors?.form && <p className="text-body-m text-error">{state.errors.form}</p>}
      {state.ok && <p className="flex items-center gap-1.5 text-body-m text-success" role="status"><Icon name="check" size={18} /> {state.message}</p>}
      <Button type="submit" variant="tonal" disabled={pending}>{pending ? 'Salvando…' : 'Trocar senha'}</Button>
    </form>
  );
}
