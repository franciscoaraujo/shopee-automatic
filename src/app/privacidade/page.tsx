import type { Metadata } from 'next';
import { Footer, TopBar } from '@/components/landing/chrome';
import { site } from '@/lib/site';

export const metadata: Metadata = { title: 'Política de privacidade' };

// Modelo básico. Revise com quem cuida da parte jurídica do seu negócio.
export default function PrivacidadePage() {
  return (
    <>
      <TopBar />
      <main className="flex-1">
        <article className="mx-auto max-w-3xl px-5 py-16 md:py-24">
          <h1 className="text-display-s">Política de privacidade</h1>
          <div className="mt-10 space-y-8 text-body-l text-on-surface-variant [&_h2]:mb-2 [&_h2]:text-title-l [&_h2]:text-on-surface">
            <section>
              <h2>Quais dados coletamos</h2>
              <p>Da sua conta: nome, e-mail, WhatsApp e senha (guardada apenas como hash). Para operar a automação: as credenciais da Shopee Afiliados e do bot do Telegram que você informar, guardadas criptografadas (AES-256); a sessão do WhatsApp conectado por QR Code; e o histórico de ofertas publicadas e erros, exibido no seu painel.</p>
            </section>
            <section>
              <h2>Para que usamos</h2>
              <p>Exclusivamente para prestar o serviço: buscar ofertas na sua conta de afiliado, publicar nos canais que você configurou, mostrar os resultados no painel e falar com você sobre a sua conta. Não lemos as conversas do seu WhatsApp e não vendemos nem compartilhamos seus dados com terceiros para fins de marketing.</p>
            </section>
            <section>
              <h2>Base legal e retenção</h2>
              <p>Tratamos os dados para execução do contrato e com o seu consentimento (LGPD, art. 7º, I e V). Mantemos a conta enquanto houver relação comercial; ao pedir a exclusão, apagamos credenciais, sessão do WhatsApp e histórico.</p>
            </section>
            <section>
              <h2>Seus direitos</h2>
              <p>Você pode pedir acesso, correção ou exclusão dos seus dados a qualquer momento pelo e-mail <a className="text-primary underline" href={`mailto:${site.email}`}>{site.email}</a>.</p>
            </section>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
