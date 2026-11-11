import { isAdmin } from '@/lib/admin-auth';
import { ACCOUNT_STATUSES, findPlan } from '@/lib/plans';
import { listPlans } from '@/server/plans';
import { listAccounts } from '@/server/admin';

// Escapa para CSV e neutraliza injeção de fórmulas no Excel/Sheets
const cell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
const br = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');

export async function GET() {
  if (!(await isAdmin())) return new Response('Não autorizado', { status: 401 });
  const [rows, plans] = await Promise.all([listAccounts(), listPlans({ all: true })]);
  const header = ['Criado em', 'Nome', 'E-mail', 'WhatsApp', 'Plano', 'Preço especial', 'Situação', 'Teste até', 'Ofertas (7d)', 'Falhas (7d)', 'Última rodada', 'Origem'];
  const body = rows.map((a) => [
    br(a.created_at), a.name, a.email, a.whatsapp ?? '', findPlan(plans, a.plan).name, a.custom_price ? `R$ ${a.custom_price.price}` : '',
    ACCOUNT_STATUSES.find((s) => s.value === a.status)?.label ?? a.status, br(a.trial_ends_at),
    a.published_7d, a.failures_7d, br(a.last_run_at), a.source ?? '',
  ]);
  const csv = '﻿' + [header, ...body].map((r) => r.map(cell).join(';')).join('\r\n');
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="clientes-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
