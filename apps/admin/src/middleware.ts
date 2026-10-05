import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = [/^\/login/, /^\/signup/, /^\/invite\//, /^\/api\//, /^\/_next\//, /^\/favicon/];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((pattern) => pattern.test(pathname))) return NextResponse.next();
  if (!request.cookies.get('cip_rt')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
