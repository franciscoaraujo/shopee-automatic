// Dados do negócio exibidos no site. Ajuste aqui (ou via variáveis de ambiente).
export const site = {
  name: 'AutoAchados',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  // WhatsApp de atendimento: DDI + DDD + número, só dígitos (ex.: 5511999998888)
  whatsapp: process.env.NEXT_PUBLIC_WHATSAPP || '5511994554739',
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'contato@seudominio.com.br',
};

export const waLink = (text: string) => `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(text)}`;

// Mensagem que já vem escrita quando o visitante abre a conversa pelo site
export const WA_SITE_MESSAGE = `Olá! Vim pelo site do ${site.name} e quero saber mais.`;
