// Esquema das configurações de cada conta (compartilhado entre servidor e interface).
import { TIME_RE, WEEKDAYS } from './schedule';
import { INTERVAL_OPTIONS, MAX_PER_RUN, formatInterval } from './plans';
export const SORT_OPTIONS = [
  { value: 5, label: 'Maior comissão' },
  { value: 2, label: 'Mais vendidos' },
  { value: 1, label: 'Relevância' },
  { value: 4, label: 'Menor preço' },
  { value: 3, label: 'Maior preço' },
] as const;

type Base = { key: string; label: string; help?: string; placeholder?: string };
export type FieldDef =
  | (Base & { type: 'text'; pattern?: RegExp; patternMsg?: string; default?: string; max?: number })
  | (Base & { type: 'secret'; pattern?: RegExp; patternMsg?: string })
  | (Base & { type: 'bool'; default: boolean })
  | (Base & { type: 'number'; min: number; max: number; step: number; default: number; suffix?: string })
  | (Base & { type: 'percent'; min: number; max: number; default: number })
  | (Base & { type: 'select'; options: readonly { value: number; label: string }[]; default: number })
  | (Base & { type: 'time'; pattern: RegExp; default: string })
  | (Base & { type: 'days'; options: readonly { value: string; label: string }[]; default: string });

export const SECTIONS = {
  shopee: [
    { key: 'shopeeAppId', type: 'text', label: 'App ID', pattern: /^\d{4,20}$/, patternMsg: 'Somente números', placeholder: '18312345678' },
    { key: 'shopeeSecret', type: 'secret', label: 'Secret' },
  ],
  telegram: [
    { key: 'telegramEnabled', type: 'bool', label: 'Publicar no Telegram', default: false },
    { key: 'telegramBotToken', type: 'secret', label: 'Token do bot', pattern: /^\d+:[A-Za-z0-9_-]{30,}$/, patternMsg: 'Formato esperado: 123456789:AA…' },
    { key: 'telegramChatId', type: 'text', label: 'Canal ou grupo', pattern: /^(-?\d{5,20}|@[A-Za-z0-9_]{5,32})$/, patternMsg: 'Use @nomedocanal ou -100…', placeholder: '@meucanal ou -1001234567890' },
  ],
  whatsapp: [
    { key: 'whatsappEnabled', type: 'bool', label: 'Publicar no WhatsApp', default: true },
    { key: 'whatsappGroupJid', type: 'text', label: 'Grupo de destino', pattern: /^\d[\d-]*@g\.us$/, patternMsg: 'Escolha um grupo da lista' },
    { key: 'whatsappGroupName', type: 'text', label: 'Nome do grupo', max: 200 },
  ],
  search: [
    { key: 'keywords', type: 'text', label: 'Palavras-chave', default: 'fone bluetooth, air fryer, smartwatch, organizador, kit maquiagem', help: 'Separadas por vírgula. Uma por rodada, em rodízio. Vazio = ofertas gerais.', max: 1000 },
    { key: 'sortType', type: 'select', label: 'Priorizar', options: SORT_OPTIONS, default: 5 },
    { key: 'minCommissionRate', type: 'percent', label: 'Comissão mínima', min: 0, max: 1, default: 0.05 },
    { key: 'minRating', type: 'number', label: 'Avaliação mínima', min: 0, max: 5, step: 0.1, default: 4.5, suffix: '★' },
    { key: 'maxPostsPerRun', type: 'number', label: 'Ofertas por rodada', min: 1, max: MAX_PER_RUN, step: 1, default: 3 },
    { key: 'dedupDays', type: 'number', label: 'Não repetir produto por', min: 1, max: 90, step: 1, default: 7, suffix: 'dias' },
    { key: 'subIdCampaign', type: 'text', label: 'SubID da campanha', default: 'autoachados', pattern: /^[A-Za-z0-9]{1,50}$/, patternMsg: 'Somente letras e números', help: 'Aparece nos relatórios da Shopee para identificar as vendas.' },
  ],
  frequency: [
    { key: 'runIntervalMin', type: 'select', label: 'Ciclo de publicação', options: INTERVAL_OPTIONS.map((m) => ({ value: m, label: formatInterval(m) })), default: 30 },
  ],
  schedule: [
    { key: 'scheduleEnabled', type: 'bool', label: 'Enviar só em horários definidos', default: false },
    { key: 'scheduleStart', type: 'time', label: 'Começar às', pattern: TIME_RE, default: '09:00' },
    { key: 'scheduleEnd', type: 'time', label: 'Parar às', pattern: TIME_RE, default: '18:00' },
    { key: 'scheduleDays', type: 'days', label: 'Dias da semana', options: WEEKDAYS, default: '0,1,2,3,4,5,6' },
  ],
} satisfies Record<string, FieldDef[]>;

export type SectionId = keyof typeof SECTIONS;
export const ALL_FIELDS: FieldDef[] = Object.values(SECTIONS).flat();
export const FIELD = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, f])) as Record<string, FieldDef>;

export type Settings = {
  shopeeAppId: string | null;
  shopeeSecret: string | null;
  telegramEnabled: boolean;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  whatsappEnabled: boolean;
  // Legado: grupo único (hoje espelha o primeiro de whatsappGroups, para o admin separado)
  whatsappGroupJid: string | null;
  whatsappGroupName: string | null;
  // Grupos que recebem as ofertas (tabela whatsapp_groups), do mais antigo para o mais novo
  whatsappGroups: { jid: string; name: string }[];
  keywords: string;
  sortType: number;
  minCommissionRate: number;
  minRating: number;
  maxPostsPerRun: number;
  dedupDays: number;
  subIdCampaign: string;
  runIntervalMin: number;
  scheduleEnabled: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleDays: string;
};

// Visão segura para o navegador: segredos nunca saem do servidor
export type PublicSettings = Omit<Settings, 'shopeeSecret' | 'telegramBotToken'> & {
  shopeeSecret: { isSet: boolean; hint: string | null };
  telegramBotToken: { isSet: boolean; hint: string | null };
};
