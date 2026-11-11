'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { COOKIE, checkPassword, isAdmin, newSessionValue } from '@/lib/admin-auth';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { confirmEmail, deleteAccount, extendTrial, resetUserPassword, updateAccount } from '@/server/admin';
import { one } from '@/server/db';

const UUID = /^[0-9a-f-]{36}$/i;

async function guard() {
  if (!(await isAdmin())) throw new Error('Não autorizado');
}

export async function adminLogin(_prev: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  const ip = clientIp(await headers());
  if (!rateLimit(`admin-login:${ip}`, 5, 15 * 60_000)) return { error: 'Muitas tentativas. Aguarde 15 minutos.' };
  if (!checkPassword(String(fd.get('password') ?? ''))) return { error: 'Senha incorreta.' };
  const s = newSessionValue();
  (await cookies()).set(COOKIE, s.value, {
    httpOnly: true, sameSite: 'strict', path: '/', maxAge: s.maxAge,
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
  });
  redirect('/admin');
}

export async function adminLogout() {
  (await cookies()).delete(COOKIE);
  redirect('/admin');
}

export async function updateAccountAction(fd: FormData) {
  await guard();
  const id = String(fd.get('id') ?? '');
  if (!UUID.test(id)) throw new Error('ID inválido');
  await updateAccount(id, {
    status: fd.has('status') ? String(fd.get('status')) : undefined,
    plan: fd.has('plan') ? String(fd.get('plan')) : undefined,
    notes: fd.has('notes') ? String(fd.get('notes')) : undefined,
  });
  revalidatePath('/admin');
}

export async function extendTrialAction(fd: FormData) {
  await guard();
  const id = String(fd.get('id') ?? '');
  if (!UUID.test(id)) throw new Error('ID inválido');
  await extendTrial(id, 7);
  revalidatePath('/admin');
}

export async function resetPasswordAction(id: string): Promise<{ email: string; password: string } | { error: string }> {
  await guard();
  if (!UUID.test(id)) return { error: 'ID inválido' };
  return (await resetUserPassword(id)) ?? { error: 'Usuário não encontrado' };
}

export async function deleteAccountAction(id: string, confirmEmail: string): Promise<{ error?: string }> {
  await guard();
  if (!UUID.test(id)) return { error: 'ID inválido' };
  const u = await one<{ email: string }>('SELECT email FROM users WHERE account_id = $1 ORDER BY created_at LIMIT 1', [id]);
  if (!u || u.email !== confirmEmail.trim().toLowerCase()) return { error: 'E-mail de confirmação não confere' };
  await deleteAccount(id);
  revalidatePath('/admin');
  return {};
}

export async function confirmEmailAction(fd: FormData) {
  await guard();
  const id = String(fd.get('id') ?? '');
  if (!UUID.test(id)) throw new Error('ID inválido');
  await confirmEmail(id);
  revalidatePath('/admin');
}
