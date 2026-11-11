// Envio de e-mails por SMTP (qualquer provedor: Brevo, Resend, Amazon SES, Gmail…).
// Sem SMTP_HOST em desenvolvimento, o e-mail é apenas mostrado no log do servidor.
import nodemailer, { type Transporter } from 'nodemailer';

let transport: Transporter | null = null;

export const appUrl = () => (process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');

function getTransport(): Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  });
  return transport;
}

export async function sendMail(msg: { to: string; subject: string; html: string; text: string }) {
  const t = getTransport();
  const from = process.env.MAIL_FROM || 'AutoAchados <nao-responda@localhost>';
  if (!t) {
    if (process.env.NODE_ENV === 'production') console.error('SMTP_HOST não configurado: e-mail NÃO enviado para', msg.to);
    console.log(`\n── e-mail (não enviado: SMTP não configurado) ──\nPara: ${msg.to}\nAssunto: ${msg.subject}\n\n${msg.text}\n──────────────\n`);
    return;
  }
  await t.sendMail({ from, ...msg });
}
