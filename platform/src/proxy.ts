// Checagem otimista: sem cookie de sessão, /app redireciona direto para o login (HTTP 307).
// A validação real da sessão continua no layout do /app (requireSession).
import { NextResponse, type NextRequest } from 'next/server';
import { publicUrl } from '@/lib/public-url';

export function proxy(request: NextRequest) {
  if (!request.cookies.has('aa_session')) {
    const url = publicUrl(request, '/entrar');
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/app', '/app/:path*'] };
