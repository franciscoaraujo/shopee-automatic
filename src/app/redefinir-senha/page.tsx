import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/app/(auth)/forms';
import { Icon } from '@/components/icons';
import { Logo } from '@/components/landing/chrome';
import { peekToken } from '@/server/email-tokens';

export const metadata: Metadata = { title: 'Criar nova senha', robots: { index: false }, referrer: 'no-referrer' };

async function Content({ searchParams }: { searchParams: PageProps<'/redefinir-senha'>['searchParams'] }) {
  await connection();
  const sp = await searchParams;
  const token = typeof sp.token === 'string' ? sp.token : '';
  const valid = token ? await peekToken(token, 'reset') : null;

  if (!valid) {
    return (
      <div className="space-y-5 rounded-xl bg-surface-lowest p-6 shadow-e1 sm:p-8">
        <span className="grid size-12 place-items-center rounded-full bg-error-container text-on-error-container"><Icon name="link_off" size={26} /></span>
        <h1 className="text-headline-s">Link inválido ou expirado</h1>
        <p className="text-body-l text-on-surface-variant">Os links de redefinição valem por 1 hora e só podem ser usados uma vez. Peça um novo.</p>
        <Link href="/recuperar-senha" className="state-layer inline-flex h-10 items-center rounded-full bg-primary px-6 text-label-l text-on-primary">Pedir novo link</Link>
      </div>
    );
  }
  return <ResetPasswordForm token={token} />;
}

export default function RedefinirSenhaPage({ searchParams }: PageProps<'/redefinir-senha'>) {
  return (
    <main className="grid flex-1 place-items-center bg-surface-low px-5 py-16">
      <div className="w-full max-w-md">
        <Logo className="mb-8 justify-center" />
        <Suspense fallback={<div className="h-80 rounded-xl bg-surface-lowest shadow-e1" />}>
          <Content searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
