// Limite simples em memória (por instância). Suficiente contra abuso casual;
// atrás de vários servidores, troque por Redis/Upstash.
const g = globalThis as unknown as { __rl?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__rl ??= new Map<string, number[]>());

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  }
  return true;
}

export function clientIp(h: Headers): string {
  return (h.get('x-forwarded-for')?.split(',')[0] || h.get('x-real-ip') || 'local').trim();
}
