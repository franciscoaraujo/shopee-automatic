// URL pública para redirecionamentos. Dentro do Docker o Next enxerga o próprio endereço como
// 0.0.0.0:3000; o domínio real vem do cabeçalho Host (ou X-Forwarded-Host, atrás do Caddy).
export function publicUrl(req: { headers: Headers; url: string }, path: string): URL {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return new URL(path, req.url);
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return new URL(path, `${proto}://${host}`);
}
