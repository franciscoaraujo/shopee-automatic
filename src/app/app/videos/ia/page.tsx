import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Icon } from '@/components/icons';
import { requireSession } from '@/server/session';
import { platformModel, platformStatus, premiumQuota } from '@/server/videos/platform';
import { providerTypes } from '@/server/videos/providers';
import { listProviders } from '@/server/videos/repo';
import { Card } from '../ui';
import { AddProvider, ProviderCard } from './providers';

export const metadata: Metadata = { title: 'Configurações de IA' };

async function Content() {
  await connection();
  const { account } = await requireSession();
  const [providers, status, quota] = await Promise.all([listProviders(account.id), platformStatus(), premiumQuota(account.id)]);
  const types = providerTypes();
  const pm = platformModel();

  return (
    <div className="grid gap-3">
      {/* Premium: IA da plataforma */}
      <section className="rounded-xl border border-primary/50 bg-surface-lowest p-6">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid size-11 place-items-center rounded-md bg-primary text-on-primary"><Icon name="star" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-title-l">Vídeos Premium <span className="rounded-xs bg-primary/10 px-2 text-label-m text-primary">Google Gemini</span></h2>
            <p className="mt-1 text-body-m text-on-surface-variant">Incluídos no seu plano. Não precisa de conta no Google nem de chave: a plataforma cuida de tudo.</p>
          </div>
          <span className={`inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-label-m ${status.ok ? 'bg-success-container text-on-success-container' : 'bg-surface-high text-on-surface-variant'}`}>
            <Icon name={status.ok ? 'check_circle' : 'schedule'} size={16} /> {status.ok ? 'Disponível' : 'Indisponível'}
          </span>
        </div>
        <dl className="mt-5 grid gap-x-6 gap-y-3 text-body-m sm:grid-cols-3">
          <div>
            <dt className="text-label-m text-on-surface-variant">Cota deste mês</dt>
            <dd className="tabular-nums">{quota.limit === 0 ? 'Não incluída no seu plano' : `${quota.used} de ${quota.limit} usados · ${quota.remaining} restantes`}</dd>
          </div>
          <div><dt className="text-label-m text-on-surface-variant">Duração e qualidade</dt><dd>{pm ? `até ${pm.maxDuration} s · até ${pm.resolutions[pm.resolutions.length - 1]}` : '—'}</dd></div>
          <div><dt className="text-label-m text-on-surface-variant">Formatos</dt><dd>{pm ? pm.aspectRatios.join(', ') : '—'}</dd></div>
        </dl>
        {quota.limit > 0 && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-container" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (quota.used / quota.limit) * 100)}%` }} />
          </div>
        )}
        {!status.ok && <p className="mt-4 text-body-s text-on-surface-variant">{status.message}</p>}
        <p className="mt-4 text-body-s text-on-surface-variant">Vídeos que falham não contam na cota. A cota renova todo dia 1º.</p>
      </section>

      {/* Econômico: chave do cliente */}
      <div className="mt-4">
        <h2 className="text-title-l">Vídeos Econômicos <span className="ml-1 rounded-xs bg-secondary-container px-2 text-label-m text-on-secondary-container">xAI Grok</span></h2>
        <p className="mt-1 text-body-m text-on-surface-variant">Use sua própria chave do Grok: os vídeos são cobrados na sua conta xAI, dentro do limite que você definir lá. A partir de US$ 0,02 por segundo.</p>
      </div>
      {providers.filter((p) => types.some((t) => t.type === p.type)).map((p) => <ProviderCard key={p.id} p={p} type={types.find((t) => t.type === p.type)} />)}
      {providers.some((p) => !types.some((t) => t.type === p.type)) && (
        <div className="mt-2 flex items-start gap-3 rounded-lg border border-outline-variant bg-surface-low p-4 text-body-m">
          <Icon name="info" className="mt-0.5 shrink-0 text-tertiary" />
          <p className="flex-1">Você tem uma chave do Google Gemini cadastrada de antes. Ela não é mais usada: os vídeos premium agora usam a IA da plataforma, sem custo na sua conta Google. Recomendamos removê-la.</p>
        </div>
      )}
      {providers.filter((p) => !types.some((t) => t.type === p.type)).map((p) => <ProviderCard key={p.id} p={p} />)}
      <Card title={providers.length ? 'Adicionar outra chave' : 'Adicionar sua chave do Grok'}
        description="A chave fica criptografada no servidor e nunca é enviada ao navegador.">
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
