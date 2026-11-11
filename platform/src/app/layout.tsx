import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Instrument_Sans } from 'next/font/google';
import { site } from '@/lib/site';
import './globals.css';

const display = Bricolage_Grotesque({
  variable: '--font-display',
  subsets: ['latin'],
  axes: ['opsz'],
  display: 'swap',
});

const body = Instrument_Sans({
  variable: '--font-body',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} · Seu grupo de ofertas Shopee publicando sozinho`,
    template: `%s · ${site.name}`,
  },
  description:
    'Automação para afiliados Shopee: encontra ofertas com boa comissão, gera seu link de afiliado e publica com foto e texto no WhatsApp e no Telegram, a cada 30 minutos.',
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: site.name,
    title: `${site.name} · Ofertas Shopee no piloto automático`,
    description: 'Encontra a oferta, gera seu link de afiliado e publica no WhatsApp e no Telegram. Sozinho.',
  },
};

export const viewport: Viewport = {
  themeColor: '#fff8f6',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${body.variable} h-full`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
