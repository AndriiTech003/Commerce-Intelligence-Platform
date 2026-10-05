import { NextResponse, type NextRequest } from 'next/server';
import { uuidv7 } from '@cip/contracts';
import { ANON_COOKIE, STORE_COOKIE, STORE_HEADER, defaultStore, resolveStoreSlug } from './lib/store-slug';

const YEAR = 60 * 60 * 24 * 365;

export function middleware(request: NextRequest) {
  const { slug, source } = resolveStoreSlug({
    host: request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
    query: request.nextUrl.searchParams.get('store'),
    cookie: request.cookies.get(STORE_COOKIE)?.value,
    fallback: defaultStore(),
  });
  const headers = new Headers(request.headers);
  headers.set(STORE_HEADER, slug);
  const response = NextResponse.next({ request: { headers } });
  if (source === 'query' && request.cookies.get(STORE_COOKIE)?.value !== slug) {
    response.cookies.set(STORE_COOKIE, slug, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  }
  if (!request.cookies.get(ANON_COOKIE)?.value) {
    response.cookies.set(ANON_COOKIE, uuidv7(), { path: '/', maxAge: YEAR, sameSite: 'lax' });
  }
  return response;
}

export const config = {
  matcher: ['/((?!api/|_next/|_vercel/|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.[a-zA-Z0-9]+$).*)'],
};
