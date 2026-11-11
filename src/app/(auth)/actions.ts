'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { planExists } from '@/server/plans';
import { createAccountWithOwner, dummyPasswordCheck, findUserForLogin, setPassword, verifyPassword } from '@/server/accounts';
import { one, q } from '@/server/db';
import { resetPassword as resetEmail, verifyEmail } from '@/server/email-templates';
import { consumeToken, issueToken } from '@/server/email-tokens';
import { appUrl, sendMail } from '@/server/mail';
import { endSession, startSession } from '@/server/session';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export type FormState = { errors?: Record<string, string>; values?: Record<string, string>; unverified?: boolean; message?: string };

const emailSchema = z.string().trim().toLowerCase().max(200).email('E-mail inválido');

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(120, 'Nome muito longo'),
  email: emailSchema,
  whatsapp: z
    .string()
    .transform((s) => s.replace(/\D/g, ''))
    .transform((d) => (d.length === 10 || d.length === 11 ? `55${d}` : d))
    .refine((d) => /^55\d{10,11}$/.test(d), 'Informe DDD + número'),
  password: z.string().min(10, 'Mínimo de 10 caracteres').max(200),
  plan: z.string().regex(/^[a-z0-9_-]{2,30}$/, 'Escolha um plano'),
  coupon: z.string().trim().toUpperCase().max(30).refine((c) => !c || /^[A-Z0-9_-]{3,30}$/.test(c), 'Cupom inválido'),
  consent: z.literal('on', { message: 'É preciso aceitar para continuar' }),
});

async function sendVerification(user: { id: string; name: string; email: string }) {
  const token = await issueToken(user.id, 'verify');
  const msg = verifyEmail(user.name, `${appUrl()}/confirmar-email?token=${token}`);
  await sendMail({ to: user.email, ...msg });
}

/* ------------------------------------------------------------------ cadastro */
export async function signup(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = Object.fromEntries(['name', 'email', 'whatsapp', 'password', 'plan', 'consent', 'source', 'coupon'].map((k) => [k, String(fd.get(k) ?? '')]));
  const values = { name: raw.name, email: raw.email, whatsapp: raw.whatsapp, plan: raw.plan, consent: raw.consent, coupon: raw.coupon };

  if (String(fd.get('company_site') ?? '').trim()) return { errors: { form: 'Não foi possível concluir.' } }; // robô

  const ip = clientIp(await headers());
  if (!rateLimit(`signup:${ip}`, 5, 60 * 60_000)) {
    return { values, errors: { form: 'Muitas contas criadas a partir desta rede. Tente mais tarde.' } };
  }

  const parsed = signupSchema.safeParse({ ...raw, consent: raw.consent || undefined });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    return { values, errors };
  }

  const d = parsed.data;
  if (!(await planExists(d.plan, { visibleOnly: true }))) return { values, errors: { plan: 'Escolha um plano' } };
  const res = await createAccountWithOwner({
    name: d.name, email: d.email, password: d.password, whatsapp: d.whatsapp, plan: d.plan,
    source: raw.source.slice(0, 200) || null, coupon: d.coupon || null,
  });
  if ('error' in res) {
    if (res.error === 'coupon_invalid') return { values, errors: { coupon: 'Cupom inválido, expirado ou não vale para este plano' } };
    return { values, errors: { email: 'Já existe uma conta com este e-mail. Entre ou use outro.' } };
  }

  try {
    await sendVerification(res.user);
  } catch (err) {
    console.error('Falha ao enviar e-mail de confirmação:', err);
  }
  redirect(`/verifique-email?email=${encodeURIComponent(d.email)}`);
}

/* ------------------------------------------------------------------ login */
export async function login(_prev: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase().slice(0, 200);
  const password = String(fd.get('password') ?? '');
  const values = { email };
  const ip = clientIp(await headers());

  if (!rateLimit(`login-ip:${ip}`, 20, 15 * 60_000) || !rateLimit(`login-email:${email}`, 8, 15 * 60_000)) {
    return { values, errors: { form: 'Muitas tentativas. Aguarde 15 minutos.' } };
  }
  if (!email || !password) return { values, errors: { form: 'Informe e-mail e senha.' } };

  const user = await findUserForLogin(email);
  const ok = user ? await verifyPassword(password, user.password_hash) : await dummyPasswordCheck(password).then(() => false);
  if (!user || !ok) return { values, errors: { form: 'E-mail ou senha incorretos.' } };

  // Só informa "não confirmado" para quem acertou a senha (não revela contas a terceiros)
  if (!user.email_verified_at) {
    return { values, unverified: true, errors: { form: 'Confirme seu e-mail para entrar. Enviamos o link quando você criou a conta.' } };
  }

  const firstLogin = !user.last_login_at;
  await startSession(user.id);
  const next = String(fd.get('next') ?? '');
  if (next.startsWith('/app') && !next.startsWith('//')) redirect(next);
  redirect(firstLogin ? '/app/configuracoes?bem-vindo=1' : '/app');
}

export async function logout() {
  await endSession();
  redirect('/entrar');
}

/* ------------------------------------------------------------------ reenvio da confirmação */
export async function resendVerification(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(String(fd.get('email') ?? ''));
  const ip = clientIp(await headers());
  const generic = { message: 'Se houver uma conta aguardando confirmação com este e-mail, enviamos um novo link.' };
  if (!parsed.success) return { errors: { form: 'Informe um e-mail válido.' } };
  if (!rateLimit(`resend-ip:${ip}`, 10, 15 * 60_000) || !rateLimit(`resend:${parsed.data}`, 3, 15 * 60_000)) {
    return { errors: { form: 'Muitos pedidos. Aguarde alguns minutos e confira também a caixa de spam.' } };
  }
  const u = await one<{ id: string; name: string; email: string; email_verified_at: Date | null }>(
    'SELECT id, name, email, email_verified_at FROM users WHERE email = $1', [parsed.data]
  );
  if (u && !u.email_verified_at) {
    try { await sendVerification(u); } catch (err) { console.error('Falha ao reenviar confirmação:', err); }
  }
  return generic;
}

/* ------------------------------------------------------------------ recuperação de senha */
export async function requestPasswordReset(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(String(fd.get('email') ?? ''));
  if (!parsed.success) return { values: { email: String(fd.get('email') ?? '') }, errors: { email: 'Informe um e-mail válido.' } };
  const ip = clientIp(await headers());
  if (!rateLimit(`reset-ip:${ip}`, 10, 15 * 60_000) || !rateLimit(`reset:${parsed.data}`, 3, 15 * 60_000)) {
    return { values: { email: parsed.data }, errors: { form: 'Muitos pedidos. Aguarde alguns minutos e confira também a caixa de spam.' } };
  }
  const u = await one<{ id: string; name: string; email: string }>('SELECT id, name, email FROM users WHERE email = $1', [parsed.data]);
  if (u) {
    try {
      const token = await issueToken(u.id, 'reset');
      await sendMail({ to: u.email, ...resetEmail(u.name, `${appUrl()}/redefinir-senha?token=${token}`) });
    } catch (err) {
      console.error('Falha ao enviar e-mail de redefinição:', err);
    }
  }
  // Mesma resposta com ou sem conta: não revela quais e-mails estão cadastrados
  return { values: { email: parsed.data }, message: 'sent' };
}

export async function resetPasswordWithToken(_prev: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get('token') ?? '');
  const password = String(fd.get('password') ?? '');
  const confirm = String(fd.get('confirm') ?? '');
  const ip = clientIp(await headers());
  if (!rateLimit(`reset-submit:${ip}`, 10, 15 * 60_000)) return { errors: { form: 'Muitas tentativas. Aguarde alguns minutos.' } };
  if (password.length < 10) return { errors: { password: 'Mínimo de 10 caracteres' } };
  if (password.length > 200) return { errors: { password: 'Senha muito longa' } };
  if (password !== confirm) return { errors: { confirm: 'As senhas não coincidem' } };

  const t = await consumeToken(token, 'reset');
  if (!t) return { errors: { form: 'Este link expirou ou já foi usado. Peça um novo.' } };

  await setPassword(t.user_id, password);
  // Quem recebeu o link no e-mail comprovou que o e-mail é dele
  await q('UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1', [t.user_id]);
  await q('DELETE FROM sessions WHERE user_id = $1', [t.user_id]);
  redirect('/entrar?senha=redefinida');
}
