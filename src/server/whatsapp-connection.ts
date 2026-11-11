// Conexão do WhatsApp de uma conta. O QR Code só é gerado depois de o cliente confirmar que
// usará um número dedicado ao grupo de ofertas (reduz o dano de um banimento: o número
// pessoal fica de fora).
import { q } from './db';
import { waConnect } from './integrations';

export type ConnectResult = Awaited<ReturnType<typeof waConnect>> & { error?: string };

// Resposta de erro sem QR Code (mesmo formato do sucesso, para a tela tratar igual)
export const connectError = (error: string): ConnectResult => ({ qr: null, pairingCode: null, state: 'error', error });

export async function connectWhatsApp(
  accountId: string,
  input: { dedicatedNumberConfirmed: boolean },
  connect: typeof waConnect = waConnect,
): Promise<ConnectResult> {
  if (input.dedicatedNumberConfirmed) {
    // Guarda a primeira confirmação (a data não muda em reconexões)
    await q('UPDATE accounts SET whatsapp_dedicated_confirmed_at = coalesce(whatsapp_dedicated_confirmed_at, now()) WHERE id = $1', [accountId]);
  } else {
    // Sem a caixa marcada, só passa quem já confirmou antes (ex.: a renovação automática do QR Code)
    const [row] = await q<{ ok: boolean }>('SELECT whatsapp_dedicated_confirmed_at IS NOT NULL AS ok FROM accounts WHERE id = $1', [accountId]);
    if (!row?.ok) {
      return connectError('Confirme que usará um número dedicado ao grupo de ofertas.');
    }
  }
  return connect(accountId);
}
