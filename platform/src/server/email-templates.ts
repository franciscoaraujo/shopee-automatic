// Modelos de e-mail (HTML com tabelas e estilos inline, compatível com Gmail/Outlook) + versão em texto.
const C = { bg: '#fff8f6', card: '#ffffff', ink: '#261814', muted: '#53433f', line: '#e9d8d2', primary: '#9b2f00', onPrimary: '#ffffff' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(o: { preheader: string; title: string; paragraphs: string[]; cta: { label: string; url: string }; footnote: string }) {
  const p = o.paragraphs.map((t) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${C.muted}">${esc(t)}</p>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 16px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
    <tr><td style="padding:0 4px 20px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="background:${C.primary};color:${C.onPrimary};width:32px;height:32px;border-radius:10px;text-align:center;font-weight:700;font-size:18px">&#9889;</td>
        <td style="padding-left:10px;font-size:19px;font-weight:700;color:${C.ink}">AutoAchados</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:20px;padding:36px 32px">
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:${C.ink}">${esc(o.title)}</h1>
      ${p}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr>
        <td style="background:${C.primary};border-radius:999px">
          <a href="${esc(o.cta.url)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:${C.onPrimary};text-decoration:none">${esc(o.cta.label)}</a>
        </td>
      </tr></table>
      <p style="margin:0 0 6px;font-size:13px;color:${C.muted}">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
      <p style="margin:0;font-size:13px;word-break:break-all"><a href="${esc(o.cta.url)}" style="color:${C.primary}">${esc(o.cta.url)}</a></p>
    </td></tr>
    <tr><td style="padding:20px 8px;font-size:12px;line-height:1.5;color:${C.muted};text-align:center">${esc(o.footnote)}</td></tr>
  </table>
</td></tr></table></body></html>`;
}

export function verifyEmail(name: string, url: string) {
  const first = name.split(' ')[0];
  return {
    subject: 'Confirme seu e-mail para ativar sua conta',
    html: layout({
      preheader: 'Falta um clique para ativar sua conta no AutoAchados.',
      title: `Bem-vindo, ${first}!`,
      paragraphs: [
        'Sua conta no AutoAchados foi criada. Para ativá-la, confirme que este e-mail é seu.',
        'Depois de confirmar, você vai para a tela de login e já pode configurar sua esteira de ofertas. Seu teste grátis de 7 dias já está valendo.',
      ],
      cta: { label: 'Confirmar e-mail e entrar', url },
      footnote: 'O link vale por 48 horas. Se você não criou esta conta, ignore este e-mail.',
    }),
    text: `Bem-vindo, ${first}!\n\nSua conta no AutoAchados foi criada. Confirme seu e-mail para ativá-la:\n${url}\n\nDepois de confirmar, você vai para a tela de login.\nO link vale por 48 horas. Se você não criou esta conta, ignore este e-mail.`,
  };
}

export function resetPassword(name: string, url: string) {
  const first = name.split(' ')[0];
  return {
    subject: 'Redefinição de senha',
    html: layout({
      preheader: 'Crie uma nova senha para sua conta no AutoAchados.',
      title: 'Redefinir sua senha',
      paragraphs: [
        `Olá, ${first}. Recebemos um pedido para redefinir a senha da sua conta no AutoAchados.`,
        'Clique no botão abaixo para criar uma nova senha. Por segurança, todas as sessões abertas serão encerradas.',
      ],
      cta: { label: 'Criar nova senha', url },
      footnote: 'O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.',
    }),
    text: `Olá, ${first}.\n\nRecebemos um pedido para redefinir a senha da sua conta no AutoAchados.\nCrie uma nova senha neste link (vale por 1 hora, uso único):\n${url}\n\nSe você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.`,
  };
}
