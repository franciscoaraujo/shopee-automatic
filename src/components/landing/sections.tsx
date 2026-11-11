// Seções da landing page (componentes de servidor, sem JavaScript no cliente)
import { connection } from 'next/server';
import { TRIAL_DAYS, TRIAL_PLAN } from '@/lib/plans';
import { listPlans } from '@/server/plans';
import { Icon, type IconName } from '../icons';
import { LinkButton, SectionLabel, buttonClass } from '../md';
import { waLink, WA_SITE_MESSAGE } from '@/lib/site';

/* ------------------------------------------------------------------ Uma rodada por dentro */
const RUN: { t: string; icon: IconName; title: string; detail: string; out: string }[] = [
  { t: '10:30:00', icon: 'search', title: 'Busca', detail: 'Consulta a API oficial de afiliados pela palavra-chave da vez.', out: '30 produtos · “fone bluetooth”' },
  { t: '10:30:02', icon: 'filter_alt', title: 'Filtra', detail: 'Comissão mínima, nota mínima, oferta válida e nada repetido.', out: '3 aprovados de 30' },
  { t: '10:30:03', icon: 'link', title: 'Gera o link', detail: 'Link curto criado na sua conta de afiliado, com SubID.', out: 's.shopee.com.br/1LhE… · SubID esteira' },
  { t: '10:30:04', icon: 'edit_note', title: 'Escreve', detail: 'Foto, preço de/por, desconto, avaliação e chamada para ação.', out: '3 legendas prontas' },
  { t: '10:30:12', icon: 'send', title: 'Publica', detail: 'Envia com intervalo entre as mensagens para cada canal ativo.', out: 'WhatsApp ✓  Telegram ✓' },
];

export function RunSection() {
  return (
    <section id="rodada" className="scroll-mt-20 py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid gap-6 md:grid-cols-[1fr_1.1fr] md:items-end">
          <div>
            <SectionLabel>Como funciona</SectionLabel>
            <h2 className="text-display-m text-balance">Uma rodada leva 12 segundos. Acontece o dia inteiro.</h2>
          </div>
          <p className="text-body-l text-on-surface-variant md:pb-2">
            Este é o registro real de uma rodada. Ela se repete no ciclo que você escolher, de 10 minutos a 4 horas, trocando de
            palavra-chave a cada vez para variar o que aparece no seu grupo.
          </p>
        </div>

        <ol className="mt-14 grid gap-px overflow-hidden rounded-xl border border-outline-variant bg-outline-variant md:grid-cols-5">
          {RUN.map((s, i) => (
            <li key={s.title} className="flex flex-col bg-surface-lowest p-6">
              <div className="flex items-center justify-between">
                <span className="grid size-11 place-items-center rounded-md bg-primary-container/10 text-primary">
                  <Icon name={s.icon} />
                </span>
                <span className="font-mono text-body-s text-on-surface-variant">{s.t}</span>
              </div>
              <h3 className="mt-6 text-title-l">
                <span className="mr-1.5 text-on-surface-variant/60">{i + 1}.</span>
                {s.title}
              </h3>
              <p className="mt-2 flex-1 text-body-m text-on-surface-variant">{s.detail}</p>
              <p className="mt-5 rounded-sm bg-surface-container px-3 py-2 font-mono text-[12px] leading-5 text-on-surface">{s.out}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Manual x automático */
const MANUAL = [
  'Garimpar produto no app, um por um',
  'Conferir se a comissão vale a pena',
  'Gerar o link de afiliado e encurtar',
  'Baixar a foto e escrever o texto',
  'Colar em cada grupo e canal',
  'Lembrar o que já foi postado',
];

export function CompareSection() {
  return (
    <section className="bg-surface-low py-24 md:py-32">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 md:grid-cols-[0.9fr_1.1fr] md:gap-20">
        <div>
          <SectionLabel>Antes e depois</SectionLabel>
          <h2 className="text-display-m text-balance">Seis tarefas por post viram nenhuma.</h2>
          <p className="mt-6 max-w-md text-body-l text-on-surface-variant">
            Grupo de ofertas vive de constância. Quando a postagem depende de você, ela para no fim de semana, na hora do almoço e
            quando você dorme, e o grupo esfria.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-outline-variant bg-surface p-6">
            <p className="text-title-m text-on-surface-variant">Do jeito manual</p>
            <ul className="mt-5 space-y-3.5">
              {MANUAL.map((m) => (
                <li key={m} className="flex gap-3 text-body-m text-on-surface-variant">
                  <Icon name="remove" size={20} className="mt-px text-outline" />
                  {m}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl bg-inverse-surface p-6 text-inverse-on-surface">
            <p className="text-title-m text-inverse-primary">Com o {`AutoAchados`}</p>
            <ul className="mt-5 space-y-3.5">
              {['Busca e escolhe sozinho', 'Filtra pela sua comissão mínima', 'Link de afiliado com SubID', 'Foto e texto prontos', 'Publica no WhatsApp e Telegram', 'Nunca repete dentro do prazo'].map((m) => (
                <li key={m} className="flex gap-3 text-body-m">
                  <Icon name="check" size={20} className="mt-px text-inverse-primary" />
                  {m}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Controle (configurações) */
function MockSwitch({ on }: { on: boolean }) {
  return (
    <span className={`relative inline-flex h-8 w-[52px] items-center rounded-full border-2 ${on ? 'border-primary bg-primary' : 'border-outline bg-surface-highest'}`} aria-hidden>
      <span className={`absolute grid place-items-center rounded-full transition-all ${on ? 'right-1 size-6 bg-on-primary text-primary' : 'left-1.5 size-4 bg-outline'}`}>
        {on && <Icon name="check" size={16} />}
      </span>
    </span>
  );
}

export function ControlSection() {
  return (
    <section id="controle" className="scroll-mt-20 py-24 md:py-32">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 md:grid-cols-2 md:gap-20">
        <div className="order-2 md:order-1">
          {/* Simulação da tela de configurações do painel */}
          <div className="rounded-xl border border-outline-variant bg-surface-lowest p-6 shadow-e1 md:p-8" role="img" aria-label="Tela de configurações do painel">
            <div className="flex items-center justify-between">
              <p className="text-title-l">Busca e publicação</p>
              <span className="rounded-sm bg-success-container px-2 py-1 text-label-m text-on-success-container">Salvo</span>
            </div>
            <p className="mt-6 text-label-l text-on-surface-variant">Palavras-chave em rodízio</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {['fone bluetooth', 'air fryer', 'smartwatch', 'organizador', 'kit maquiagem'].map((k) => (
                <span key={k} className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-secondary-container px-3 text-label-l text-on-secondary-container">
                  {k}
                  <Icon name="close" size={16} />
                </span>
              ))}
            </div>

            <div className="mt-8 grid grid-cols-2 gap-6">
              <div>
                <p className="text-label-l text-on-surface-variant">Comissão mínima</p>
                <p className="mt-1 font-display text-3xl font-semibold">5%</p>
                <div className="relative mt-3 h-1 rounded-full bg-secondary-container" aria-hidden>
                  <span className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-primary" />
                  <span className="absolute -top-2 left-1/3 h-5 w-1 -translate-x-1/2 rounded-full bg-primary" />
                </div>
              </div>
              <div>
                <p className="text-label-l text-on-surface-variant">Nota mínima</p>
                <p className="mt-1 flex items-baseline gap-1 font-display text-3xl font-semibold">
                  4,5 <Icon name="star_fill" size={22} className="text-[#e8a33d]" />
                </p>
                <p className="mt-2 text-body-s text-on-surface-variant">de 5 estrelas</p>
              </div>
            </div>

            <div className="mt-8 divide-y divide-outline-variant/70 border-t border-outline-variant/70">
              {[
                { label: 'Publicar no WhatsApp', on: true },
                { label: 'Publicar no Telegram', on: true },
                { label: 'Ofertas por rodada', value: '3' },
                { label: 'Não repetir produto por', value: '7 dias' },
              ].map((r) => (
                <div key={r.label} className="flex items-center justify-between py-3.5">
                  <span className="text-body-l">{r.label}</span>
                  {'on' in r ? <MockSwitch on={!!r.on} /> : <span className="text-title-m">{r.value}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="order-1 md:order-2">
          <SectionLabel>Controle</SectionLabel>
          <h2 className="text-display-m text-balance">Você decide o que vai para o grupo.</h2>
          <p className="mt-6 text-body-l text-on-surface-variant">
            Nicho, comissão, qualidade e ritmo ficam num painel simples. Mudou de ideia? Salve e a próxima rodada já usa a regra nova,
            sem reiniciar nada.
          </p>
          <ul className="mt-8 space-y-4">
            {[
              ['tune', 'Palavras-chave em rodízio para variar os produtos'],
              ['percent', 'Só entra produto acima da comissão que você definir'],
              ['lock', 'Suas chaves ficam criptografadas e nunca aparecem na tela'],
              ['verified_user', 'Botão “Testar conexão” para cada conta antes de salvar'],
            ].map(([icon, text]) => (
              <li key={text} className="flex gap-4 text-body-l">
                <Icon name={icon as IconName} className="mt-0.5 text-primary" />
                {text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Painel (resultados) */
const BARS = [3, 3, 2, 3, 3, 1, 3, 3, 2, 3, 3, 3, 0, 3, 3, 2, 3, 3, 3, 2, 3, 3, 1, 3];

export function DashboardSection() {
  return (
    <section className="bg-inverse-surface py-24 text-inverse-on-surface md:py-32">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid gap-6 md:grid-cols-[1fr_1fr] md:items-end">
          <div>
            <p className="mb-4 text-label-l uppercase tracking-[0.14em] text-inverse-primary">Painel</p>
            <h2 className="text-display-m text-balance">Tudo o que saiu, em qual canal, e se algo falhou.</h2>
          </div>
          <p className="text-body-l text-inverse-on-surface/75 md:pb-2">
            Saúde dos serviços, envios por hora, últimas ofertas e erros num só lugar. Se o WhatsApp desconectar, você fica sabendo
            antes do seu grupo perceber.
          </p>
        </div>

        <div className="mt-14 overflow-hidden rounded-xl bg-surface text-on-surface shadow-e3" role="img" aria-label="Ilustração do painel de resultados">
          <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant px-6 py-4">
            <p className="mr-auto text-title-m">Últimas 24 horas</p>
            {['Shopee', 'WhatsApp', 'Telegram', 'Automação'].map((s) => (
              <span key={s} className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-success-container px-2.5 text-label-m text-on-success-container">
                <Icon name="check_circle_fill" size={16} /> {s}
              </span>
            ))}
          </div>
          <div className="grid md:grid-cols-[1fr_1.6fr]">
            <div className="grid grid-cols-2 gap-px border-b border-outline-variant bg-outline-variant md:border-b-0 md:border-r">
              {[
                ['Ofertas publicadas', '62'],
                ['Taxa de entrega', '100%'],
                ['Rodadas', '48'],
                ['Comissão potencial', 'R$ 1.184'],
              ].map(([k, v]) => (
                <div key={k} className="bg-surface p-6">
                  <p className="text-label-m text-on-surface-variant">{k}</p>
                  <p className="mt-2 font-display text-[2rem] font-semibold leading-none tracking-tight">{v}</p>
                </div>
              ))}
            </div>
            <div className="p-6">
              <p className="text-label-m text-on-surface-variant">Ofertas publicadas por hora</p>
              <div className="mt-4 flex h-40 items-end gap-[3px] border-b border-outline-variant" aria-hidden>
                {BARS.map((b, i) => (
                  <span key={i} className="flex-1 rounded-t-[4px] bg-primary" style={{ height: `${(b / 3) * 100}%`, opacity: b ? 1 : 0 }} />
                ))}
              </div>
              <div className="mt-2 flex justify-between font-mono text-[11px] text-on-surface-variant">
                <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
              </div>
            </div>
          </div>
          <p className="border-t border-outline-variant px-6 py-3 text-body-s text-on-surface-variant">
            Ilustração. Os números reais dependem do seu nicho, dos filtros e do público.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Planos */
const COLS: Record<number, string> = { 1: 'lg:grid-cols-1 lg:max-w-md', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' };
const until = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', timeZone: 'America/Sao_Paulo' });

// Planos e promoções vêm do banco (editados no painel administrativo)
export async function PlansSection() {
  await connection();
  const plans = await listPlans();
  const trialName = plans.find((p) => p.id === TRIAL_PLAN)?.name ?? 'Pro';
  return (
    <section id="planos" className="scroll-mt-20 py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid gap-6 md:grid-cols-[1fr_1fr] md:items-end">
          <div>
            <SectionLabel>Planos</SectionLabel>
            <h2 className="text-display-m text-balance">Comece grátis. Pague quando o grupo estiver rodando.</h2>
          </div>
          <p className="text-body-l text-on-surface-variant md:pb-2">
            {TRIAL_DAYS} dias de teste com tudo do plano {trialName}, sem cartão. Sem instalação: tudo roda na nuvem e você configura pelo painel.
          </p>
        </div>

        <div className={`mt-14 grid gap-5 ${COLS[plans.length] ?? 'md:grid-cols-2 lg:grid-cols-3'}`}>
          {plans.map((p) => (
            <article
              key={p.id}
              className={`flex flex-col rounded-xl p-8 ${p.highlight ? 'bg-primary text-on-primary shadow-e2' : 'border border-outline-variant bg-surface-lowest'}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-headline-s">{p.name}</h3>
                {p.highlight && <span className="rounded-sm bg-on-primary/15 px-2.5 py-1 text-label-m">Mais escolhido</span>}
              </div>
              <p className={`mt-1 text-body-m ${p.highlight ? 'text-on-primary/80' : 'text-on-surface-variant'}`}>{p.tagline}</p>
              {p.offer && (
                <p className={`mt-6 inline-flex w-fit items-center gap-1.5 rounded-sm px-2.5 py-1 text-label-m ${p.highlight ? 'bg-on-primary/15' : 'bg-tertiary/10 text-tertiary'}`}>
                  <Icon name="bolt" size={16} />
                  {p.offer.description}
                  {p.offer.endsAt && ` · até ${until.format(new Date(p.offer.endsAt))}`}
                </p>
              )}
              {p.offer && p.offer.priceCents < p.priceCents && (
                <p className={`mt-4 text-body-m line-through ${p.highlight ? 'text-on-primary/70' : 'text-on-surface-variant'}`}>
                  <span className="sr-only">De </span>R$ {p.price}
                </p>
              )}
              <p className={`${p.offer && p.offer.priceCents < p.priceCents ? 'mt-1' : 'mt-8'} flex flex-wrap items-baseline gap-x-1.5`}>
                <span className="text-title-m">{p.offer && p.offer.priceCents < p.priceCents && <span className="sr-only">Por </span>}R$</span>
                <span className="font-display text-[3.4rem] font-bold leading-none tracking-tight">{p.offer?.price ?? p.price}</span>
                <span className={`whitespace-nowrap text-body-m ${p.highlight ? 'text-on-primary/80' : 'text-on-surface-variant'}`}>por mês</span>
              </p>
              <ul className="mt-8 flex-1 space-y-3">
                {p.items.map((it) => (
                  <li key={it} className="flex gap-3 text-body-l">
                    <Icon name="check" size={20} className={`mt-1 ${p.highlight ? 'text-on-primary' : 'text-primary'}`} />
                    {it}
                  </li>
                ))}
              </ul>
              <LinkButton
                href={`/cadastro?plano=${p.id}`}
                variant={p.highlight ? 'inverse' : 'outlined'}
                size="lg"
                className="mt-8 w-full"
                trailingIcon="arrow_forward"
              >
                Testar {TRIAL_DAYS + (p.offer?.extraTrialDays ?? 0)} dias grátis
              </LinkButton>
            </article>
          ))}
        </div>
        <p className="mt-6 text-body-m text-on-surface-variant">Sem fidelidade. Pagamento por Pix ou cartão. Cancele quando quiser.</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Dúvidas */
const FAQ = [
  ['Preciso ter conta de afiliado na Shopee?', 'Sim. Você precisa ser afiliado e ter acesso à Open API no portal de afiliados da Shopee. É de lá que vêm o App ID e o Secret que ligam a automação à sua conta. Se ainda não tiver, ajudamos a solicitar.'],
  ['A comissão das vendas é minha?', 'Toda. Os links são gerados com as suas credenciais de afiliado. Cada link leva um SubID, então nos relatórios da Shopee você vê exatamente o que veio da automação.'],
  ['Meu número de WhatsApp pode ser bloqueado?', 'Toda automação no WhatsApp tem algum risco, por isso recomendamos um número dedicado ao grupo, não o pessoal. A automação publica em intervalos espaçados e só em grupos dos quais o número já participa, o que reduz bastante esse risco.'],
  ['Preciso instalar alguma coisa?', 'Não. A automação roda na nuvem, 24 horas por dia, mesmo com seu computador e celular desligados. Você só usa o painel no navegador.'],
  ['Preciso usar WhatsApp e Telegram?', 'Não. Você liga só o que usa. No plano Start é um canal por vez; no Pro e no Escala, os dois juntos.'],
  ['Posso escolher o horário dos envios?', 'No Start, os envios acontecem das 8h às 16h, todos os dias. No Pro, você escolhe o horário entre 6h e 23h e os dias da semana. No Escala, o controle é total: 24 horas, madrugada e qualquer combinação de dias.'],
  ['Posso escolher os produtos?', 'Você escolhe as palavras-chave, a comissão mínima, a nota mínima, quantas ofertas por rodada e por quanto tempo um produto não pode se repetir.'],
  ['Quanto vou ganhar?', 'Depende do seu público e do seu nicho. A automação garante constância e qualidade nas postagens; não prometemos valores de comissão.'],
  ['Preciso saber programar?', 'Não. Você cola duas chaves da Shopee, lê um QR Code e escolhe o grupo. O resto é configuração por botões.'],
  ['Como funciona o teste grátis?', 'Você cria a conta e usa tudo do plano Pro por 7 dias, sem cartão. Se gostar, assina pelo WhatsApp com Pix ou cartão; se não, a conta só pausa.'],
];

export function FaqSection() {
  return (
    <section id="duvidas" className="scroll-mt-20 bg-surface-low py-24 md:py-32">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 md:grid-cols-[0.8fr_1.2fr] md:gap-20">
        <div>
          <SectionLabel>Dúvidas</SectionLabel>
          <h2 className="text-display-m">Perguntas frequentes</h2>
          <p className="mt-6 text-body-l text-on-surface-variant">Não achou sua resposta? Chame o suporte pelo WhatsApp.</p>
        </div>
        <div className="divide-y divide-outline-variant border-y border-outline-variant">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-title-m [&::-webkit-details-marker]:hidden">
                {q}
                <span className="grid size-8 shrink-0 place-items-center rounded-full text-on-surface-variant transition-transform duration-300 group-open:rotate-180">
                  <Icon name="keyboard_arrow_down" />
                </span>
              </summary>
              <p className="max-w-prose pb-6 text-body-l text-on-surface-variant">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ CTA final */
export function FinalCta() {
  return (
    <section className="py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5">
        <div className="relative overflow-hidden rounded-xl bg-primary-container px-8 py-16 text-on-primary-container md:px-16 md:py-20">
          <div className="max-w-2xl">
            <h2 className="text-display-m text-balance">Na próxima rodada, a oferta pode sair do seu grupo.</h2>
            <p className="mt-6 text-body-l text-on-primary-container/85">
              Crie a conta, conecte a Shopee e o WhatsApp e veja a primeira oferta sair do seu grupo. Grátis por 7 dias, sem cartão.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <LinkButton href="/cadastro" variant="inverse" size="lg" trailingIcon="arrow_forward">
                Começar teste grátis
              </LinkButton>
              <a href={waLink(WA_SITE_MESSAGE)} target="_blank" rel="noopener noreferrer"
                className={buttonClass('outlined', 'lg', 'border-on-primary-container/40 !text-on-primary-container')}>
                <Icon name="chat" size={20} /> Falar no WhatsApp
              </a>
            </div>
          </div>
          <Icon name="bolt" size={360} className="pointer-events-none absolute -bottom-16 -right-10 hidden text-on-primary-container/10 md:block" />
        </div>
      </div>
    </section>
  );
}

