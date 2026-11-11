import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/app/(auth)/forms';
import { Logo } from '@/components/landing/chrome';

export const metadata: Metadata = { title: 'Entrar', robots: { index: false } };

async function WithParams({ searchParams }: { searchParams: PageProps<'/entrar'>['searchParams'] }) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const notice =
    str('confirmado') ? { tone: 'success' as const, text: 'E-mail confirmado! Sua conta está ativa. Entre com sua senha.' }
    : str('senha') === 'redefinida' ? { tone: 'success' as const, text: 'Senha alterada. Entre com a nova senha.' }
    : str('link') === 'invalido' ? { tone: 'error' as const, text: 'Este link expirou ou já foi usado. Entre com sua senha; se a conta ainda não estiver confirmada, você poderá pedir um novo link.' }
    : null;
  const email = str('email')?.slice(0, 200);
  return <LoginForm next={str('next')} notice={notice} email={email} />;
}

export default function EntrarPage({ searchParams }: PageProps<'/entrar'>) {
  return (
    <main className="grid flex-1 place-items-center bg-surface-low px-5 py-16">
      <div className="w-full max-w-md">
        <Logo className="mb-8 justify-center" />
        <Suspense fallback={<div className="h-96 rounded-xl bg-surface-lowest shadow-e1" />}>
          <WithParams searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
