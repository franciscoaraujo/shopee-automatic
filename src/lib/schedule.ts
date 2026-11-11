import type { Plan } from './plans';

// Janela de envio do cliente (ex.: das 09:00 às 18:00, de segunda a sexta), no fuso de São Paulo.
// Funções puras — usadas pelo worker, pelo painel e pela validação.
export const TZ = 'America/Sao_Paulo';

export const WEEKDAYS = [
  { value: '1', label: 'Seg' },
  { value: '2', label: 'Ter' },
  { value: '3', label: 'Qua' },
  { value: '4', label: 'Qui' },
  { value: '5', label: 'Sex' },
  { value: '6', label: 'Sáb' },
  { value: '0', label: 'Dom' },
] as const;

export type Schedule = { enabled: boolean; start: string; end: string; days: string };

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const parseDays = (csv: string) => new Set(String(csv ?? '').split(',').map((d) => d.trim()).filter((d) => /^[0-6]$/.test(d)).map(Number));

// Data/hora "de parede" no fuso informado
function localParts(date: Date, tz = TZ) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, minutes: +p.hour * 60 + +p.minute, weekday: wd };
}

// Converte uma data/hora local do fuso para o instante UTC correspondente
function zonedToUtc(y: number, m: number, d: number, minutes: number, tz = TZ): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60));
  const off = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(guess).find((x) => x.type === 'timeZoneName')?.value ?? 'GMT';
  const mm = /GMT([+-])(\d{2}):?(\d{2})?/.exec(off);
  const offsetMin = mm ? (mm[1] === '-' ? -1 : 1) * (Number(mm[2]) * 60 + Number(mm[3] ?? 0)) : 0;
  return new Date(guess.getTime() - offsetMin * 60_000);
}

// A janela pertence ao dia em que COMEÇA (20:00–02:00 de segunda vai até terça às 02:00)
export function isWithin(s: Schedule, now = new Date()): boolean {
  if (!s.enabled) return true;
  const days = parseDays(s.days);
  const { minutes, weekday } = localParts(now);
  const start = toMin(s.start);
  const end = toMin(s.end);
  if (start === end) return days.has(weekday); // dia inteiro
  if (start < end) return days.has(weekday) && minutes >= start && minutes < end;
  const prev = (weekday + 6) % 7;
  return (days.has(weekday) && minutes >= start) || (days.has(prev) && minutes < end);
}

// Próxima abertura da janela a partir de agora (null se nenhum dia está marcado)
export function nextOpening(s: Schedule, now = new Date()): Date | null {
  const days = parseDays(s.days);
  if (!days.size) return null;
  const today = localParts(now);
  const base = Date.UTC(today.y, today.m - 1, today.d);
  for (let i = 0; i <= 7; i++) {
    const day = new Date(base + i * 86_400_000);
    const wd = day.getUTCDay();
    if (!days.has(wd)) continue;
    const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), toMin(s.start));
    if (at > now) return at;
  }
  return null;
}

export function describeSchedule(s: Schedule): string {
  if (!s.enabled) return 'Sem restrição de horário';
  const days = parseDays(s.days);
  const order = WEEKDAYS.filter((w) => days.has(Number(w.value)));
  const daysTxt =
    order.length === 7 ? 'todos os dias'
    : order.length === 5 && !days.has(0) && !days.has(6) ? 'de segunda a sexta'
    : order.map((w) => w.label.toLowerCase()).join(', ');
  return `Das ${s.start} às ${s.end}, ${daysTxt}`;
}

const fmtDay = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long' });
const fmtHm = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

// "hoje às 09:00", "amanhã às 09:00", "segunda-feira às 09:00"
export function describeWhen(at: Date, now = new Date()): string {
  const a = localParts(at);
  const n = localParts(now);
  const diff = Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(n.y, n.m - 1, n.d)) / 86_400_000);
  const day = diff === 0 ? 'hoje' : diff === 1 ? 'amanhã' : fmtDay.format(at);
  return `${day} às ${fmtHm.format(at)}`;
}

const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const ALL_DAYS = '0,1,2,3,4,5,6';

// Horário que vale de fato, aplicando as regras do plano sobre o que o cliente configurou
export function effectiveSchedule(plan: Pick<Plan, 'schedule'>, s: { scheduleEnabled: boolean; scheduleStart: string; scheduleEnd: string; scheduleDays: string }): Schedule {
  const p = plan.schedule;
  if (p.mode === 'fixed') return { enabled: true, start: p.start, end: p.end, days: p.days };
  if (p.mode === 'full') return { enabled: s.scheduleEnabled, start: s.scheduleStart, end: s.scheduleEnd, days: s.scheduleDays };
  // bounded: sempre há janela, limitada ao período do plano e sem virar a meia-noite
  const lo = toMin(p.earliest);
  const hi = toMin(p.latest);
  if (!s.scheduleEnabled) return { enabled: true, start: p.earliest, end: p.latest, days: s.scheduleDays || ALL_DAYS };
  let a = Math.max(toMin(s.scheduleStart), lo);
  let b = Math.min(toMin(s.scheduleEnd), hi);
  if (a >= b) { a = lo; b = hi; }
  return { enabled: true, start: fromMin(a), end: fromMin(b), days: s.scheduleDays || ALL_DAYS };
}

export function describePolicy(plan: Pick<Plan, 'schedule'>): string {
  const p = plan.schedule;
  if (p.mode === 'fixed') return `Horário fixo das ${p.start} às ${p.end}`;
  if (p.mode === 'bounded') return `Você escolhe entre ${p.earliest} e ${p.latest}`;
  return 'Controle total, inclusive 24 horas e madrugada';
}
