import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { requireSession } from '@/server/session';
import { providerTypes } from '@/server/videos/providers';
import { listProviders } from '@/server/videos/repo';
import { Card } from '../ui';
import { AddProvider, ProviderCard } from './providers';

export const metadata: Metadata = { title: 'Configurações de IA' };

async function Content() {
  await connection();
  const { account } = await requireSession();
  const [providers, types] = [await listProviders(account.id), providerTypes()];
  return (
    <div className="grid gap-3">
      {providers.map((p) => <ProviderCard key={p.id} p={p} type={types.find((t) => t.type === p.type)} />)}
      <Card title={providers.length ? 'Adicionar outro provedor' : 'Adicionar provedor de IA'}
        description="A geração é cobrada pelo provedor, na sua conta de API. A chave fica criptografada no servidor e nunca é enviada ao navegador.">
        <AddProvider types={types} />
      </Card>
    </div>
  );
}

export default function AiSettingsPage() {
  return (
    <Suspense fallback={<p className="py-12 text-body-l text-on-surface-variant">Carregando…</p>}>
      <Content />
    </Suspense>
  );
}
