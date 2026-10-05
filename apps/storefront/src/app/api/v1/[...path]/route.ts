import type { NextRequest } from 'next/server';
import { STORE_COOKIE, defaultStore, resolveStoreSlug } from '@/lib/store-slug';

export const dynamic = 'force-dynamic';

const CUSTOMER_REFRESH_COOKIE = 'cip_crt';

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4100').replace(/\/$/, '');

const FORWARD_REQUEST = [
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'cookie',
  'idempotency-key',
  'if-none-match',
  'user-agent',
  'x-anonymous-id',
  'x-request-id',
];

const FORWARD_RESPONSE = [
  'content-type',
  'cache-control',
  'etag',
  'idempotent-replayed',
  'retry-after',
  'x-anonymous-id',
  'x-request-id',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
];

function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded;
  return request.headers.get('x-real-ip');
}

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  if (
    request.method === 'POST' &&
    path.join('/') === 'storefront/auth/refresh' &&
    !request.cookies.get(CUSTOMER_REFRESH_COOKIE)
  )
    return new Response(null, { status: 204 });
  const target = `${API_INTERNAL_URL}/v1/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const { slug } = resolveStoreSlug({
    host: request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
    cookie: request.cookies.get(STORE_COOKIE)?.value,
    fallback: defaultStore(),
  });
  headers.set('x-store', slug);
  const ip = clientIp(request);
  if (ip) headers.set('x-forwarded-for', ip);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : undefined;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    return Response.json(
      { type: 'about:blank', title: 'Upstream unavailable', status: 502, code: 'UPSTREAM_UNAVAILABLE' },
      { status: 502, headers: { 'content-type': 'application/problem+json' } },
    );
  }
  const responseHeaders = new Headers();
  for (const name of FORWARD_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);
  const empty = upstream.status === 204 || upstream.status === 304 || request.method === 'HEAD';
  return new Response(empty ? null : await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
