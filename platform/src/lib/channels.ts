// Canais e suas cores — compartilhado entre componentes de servidor e de cliente.
// Paleta categórica validada (painel original): ordem fixa, a cor segue o canal.
export const SERIES = {
  whatsapp: { label: 'WhatsApp', color: '#eb6834' },
  telegram: { label: 'Telegram', color: '#2a78d6' },
} as const;
export type ChannelKey = keyof typeof SERIES;
