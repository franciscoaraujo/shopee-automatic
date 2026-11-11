'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Checkbox, FieldError, Fieldset, Segmented, TextField } from '@/components/form-fields';
import { Icon } from '@/components/icons';
import { Button } from '@/components/md';
import { TRIAL_PLAN, type Plan } from '@/lib/plans';
import { login, requestPasswordReset, resendVerification, resetPasswordWithToken, signup, type FormState } from './actions';

function maskPhone(v: string) {
  const d = v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function PhoneField({ initial, error }: { initial?: string; error?: string }) {
  const [v, setV] = useState(() => maskPhone(initial ?? ''));
  return (
    <TextField label="WhatsApp" name="whatsapp" type="tel" autoComplete="tel-national" inputMode="tel" required
      value={v} onChange={(e) => setV(maskPhone(e.target.value))} supporting="Com DDD. Para falarmos com você." error={error} />
  );
}

function FormError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <div className="rounded-md bg-error-container px-4 py-3 text-on-error-container">
      <FieldError id="form-error">{msg}</FieldError>
    </div>
  );
}

export function SignupForm({ plans, defaultPlan, defaultCoupon, source }: { plans: Plan[]; defaultPlan?: string; defaultCoupon?: string; source?: string }) {
  const [state, action, pending] = useActionState<FormState & { n?: number }, FormData>(
    async (prev, fd) => ({ ...(await signup(prev, fd)), n: (prev.n ?? 0) + 1 }),
    {}
  );
  const e = state.errors ?? {};
  const v = state.values ?? {};
  return (
    <form key={state.n} action={action} noValidate className="space-y-6 rounded-xl bg-surface-lowest p-6 shadow-e1 sm:p-8 md:p-10">
      <div>
        <h2 className="text-headline-s">Crie sua conta</h2>
        <p className="mt-1 text-body-m text-on-surface-variant">7 dias de teste com tudo do plano Pro. Sem cartão.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="Seu nome" name="name" autoComplete="name" defaultValue={v.name} error={e.name} className="sm:col-span-2" />
        <TextField label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={v.email} error={e.email} />
        <PhoneField initial={v.whatsapp} error={e.whatsapp} />
        <TextField label="Senha" name="password" type="password" autoComplete="new-password" supporting="Mínimo de 10 caracteres." error={e.password} className="sm:col-span-2" />
      </div>
      <Fieldset legend="Plano depois do teste" hint="Você pode mudar quando quiser." name="plan" error={e.plan}>
        <Segmented name="plan" options={plans.map((p) => ({ value: p.id, label: `${p.name} · R$ ${p.offer?.price ?? p.price}` }))}
          defaultValue={v.plan || defaultPlan || (plans.some((p) => p.id === TRIAL_PLAN) ? TRIAL_PLAN : plans[0]?.id)} />
      </Fieldset>
      <TextField label="Cupom de desconto (opcional)" name="coupon" autoComplete="off" defaultValue={v.coupon ?? defaultCoupon}
        error={e.coupon} supporting="Se tiver um código promocional, digite aqui." />

      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <input type="text" name="company_site" tabIndex={-1} autoComplete="off" />
      </div>
      <input type="hidden" name="source" value={source ?? ''} />

      <Checkbox name="consent" defaultChecked={v.consent === 'on'} error={e.consent}>
        Li e aceito os <Link href="/privacidade" target="_blank" className="text-primary underline underline-offset-2">termos e a política de privacidade</Link>.
      </Checkbox>
      <FormError msg={e.form} />
      <div className="flex flex-wrap items-center gap-4 pt-2">
        <Button type="submit" size="lg" disabled={pending} trailingIcon={pending ? undefined : 'arrow_forward'}>
          {pending ? 'Criando conta…' : 'Criar conta e começar'}
        </Button>
        <p className="text-body-m text-on-surface-variant">
          Já tem conta? <Link href="/entrar" className="text-primary underline underline-offset-2">Entrar</Link>
        </p>
      </div>
    </form>
  );
}

type Notice = { tone: 'success' | 'error' | 'info'; text: string } | null;

function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const cls = notice.tone === 'success' ? 'bg-success-container text-on-success-container' : notice.tone === 'error' ? 'bg-error-container text-on-error-container' : 'bg-surface-container text-on-surface';
  const icon = notice.tone === 'success' ? 'check_circle_fill' : notice.tone === 'error' ? 'error' : 'info';
  return (
    <div className={`flex items-start gap-3 rounded-md px-4 py-3 text-body-m ${cls}`} role="status">
      <Icon name={icon} size={20} className="mt-px" /> <span>{notice.text}</span>
    </div>
  );
}

// Reenvio do e-mail de confirmação (usado no login e na página "verifique seu e-mail")
export function ResendVerification({ email, compact }: { email: string; compact?: boolean }) {
  const [state, action, pending] = useActionState(resendVerification, {});
  return (
    <form action={action} className={compact ? '' : 'space-y-3'}>
      <input type="hidden" name="email" value={email} />
      <Button type="submit" variant={compact ? 'text' : 'tonal'} disabled={pending || !!state.message} icon="send" className={compact ? '-ml-3' : ''}>
        {pending ? 'Enviando…' : state.message ? 'Link enviado' : 'Reenviar e-mail de confirmação'}
      </Button>
      {state.message && <p className="text-body-s text-on-surface-variant" role="status">{state.message} Confira também a caixa de spam.</p>}
      {state.errors?.form && <p className="text-body-s text-error" role="alert">{state.errors.form}</p>}
    </form>
  );
}

export function LoginForm({ next, notice, email }: { next?: string; notice?: Notice; email?: string }) {
  const [state, action, pending] = useActionState(login, {});
  const e = state.errors ?? {};
  return (
    <div className="space-y-5 rounded-xl bg-surface-lowest p-6 shadow-e1 sm:p-8">
      <form action={action} className="space-y-5">
        <div>
          <h1 className="text-headline-s">Entrar</h1>
          <p className="mt-1 text-body-m text-on-surface-variant">Acesse o painel da sua esteira.</p>
        </div>
        {!state.errors && <NoticeBox notice={notice ?? null} />}
        <TextField label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={state.values?.email ?? email} autoFocus={!email} />
        <div>
          <TextField label="Senha" name="password" type="password" autoComplete="current-password" autoFocus={!!email} />
          <p className="mt-1.5 text-right">
            <Link href="/recuperar-senha" className="text-label-m text-primary underline-offset-2 hover:underline">Esqueci minha senha</Link>
          </p>
        </div>
        <input type="hidden" name="next" value={next ?? ''} />
        <FormError msg={e.form} />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
      {state.unverified && state.values?.email && <ResendVerification email={state.values.email} compact />}
      <p className="text-center text-body-m text-on-surface-variant">
        Ainda não tem conta? <Link href="/cadastro" className="text-primary underline underline-offset-2">Teste grátis por 7 dias</Link>
      </p>
    </div>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, {});
  if (state.message === 'sent') {
    return (
      <div className="space-y-5 rounded-xl bg-surface-lowest p-6 shadow-e1 sm:p-8" role="status">
        <span className="grid size-12 place-items-center rounded-full bg-success-container text-on-success-container"><Icon name="mail" size={26} /></span>
        <h1 className="text-headline-s">Confira seu e-mail</h1>
        <p className="text-body-l text-on-surface-variant">
          Se existir uma conta com <b className="text-on-surface">{state.values?.email}</b>, enviamos um link para criar uma nova senha.
          Ele vale por 1 hora. Confira também a caixa de spam.
        </p>
        <Link href="/entrar" className="inline-flex text-label-l text-primary underline underline-offset-2">Voltar para o login</Link>
      </div>
    );
  }
  return (
    <form action={action} noValidate className="space-y-5 rounded-xl bg-surface-lowest p-6 shadow-e1 sm:p-8">
      <div>
        <h1 className="text-headline-s">Recuperar senha</h1>
        <p className="mt-1 text-body-m text-on-surface-variant">Informe o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.</p>
      </div>
      <TextField label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={state.values?.email} error={state.errors?.email} autoFocus />
      <FormError msg={state.errors?.form} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? 'Enviando…' : 'Enviar link'}</Button>
      <p className="text-center text-body-m text-on-surface-variant">
        Lembrou? <Link href="/entrar" className="text-primary underline underline-offset-2">Voltar para o login</Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordWithToken, {});
  const e = state.errors ?? {};
  return (
    <form action={action} noValidate className="space-y-5 rounded-xl bg-surface-lowest p-6 shadow-e1 sm:p-8">
      <div>
        <h1 className="text-headline-s">Criar nova senha</h1>
        <p className="mt-1 text-body-m text-on-surface-variant">Depois de salvar, todas as sessões abertas serão encerradas e você entra com a nova senha.</p>
      </div>
      <input type="hidden" name="token" value={token} />
      <TextField label="Nova senha" name="password" type="password" autoComplete="new-password" supporting="Mínimo de 10 caracteres." error={e.password} autoFocus />
      <TextField label="Repita a nova senha" name="confirm" type="password" autoComplete="new-password" error={e.confirm} />
      <FormError msg={e.form} />
      {e.form && <Link href="/recuperar-senha" className="inline-flex text-label-l text-primary underline underline-offset-2">Pedir um novo link</Link>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? 'Salvando…' : 'Salvar nova senha'}</Button>
    </form>
  );
}
