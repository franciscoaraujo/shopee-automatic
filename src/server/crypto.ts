// Criptografia das credenciais dos clientes: AES-256-GCM.
// O AAD amarra cada valor à conta e ao campo — um segredo copiado para outra conta não descriptografa.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

let key: Buffer | null = null;

function masterKey(): Buffer {
  if (key) return key;
  const env = (process.env.APP_MASTER_KEY || '').trim();
  if (env) {
    if (!/^[0-9a-fA-F]{64}$/.test(env)) throw new Error('APP_MASTER_KEY deve ter 64 caracteres hexadecimais (openssl rand -hex 32)');
    key = Buffer.from(env, 'hex');
    return key;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_MASTER_KEY não configurada — obrigatória em produção (openssl rand -hex 32)');
  }
  // Desenvolvimento: gera e guarda em .data/master.key
  const file = path.join(process.cwd(), '.data', 'master.key');
  if (existsSync(file)) {
    key = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
  } else {
    mkdirSync(path.dirname(file), { recursive: true });
    key = randomBytes(32);
    writeFileSync(file, key.toString('hex'), { mode: 0o600 });
  }
  return key;
}

export function encrypt(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', masterKey(), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

export function decrypt(blob: string, aad: string): string {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1') throw new Error('formato desconhecido');
  const d = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
