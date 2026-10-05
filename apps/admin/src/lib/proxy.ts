const FORWARD_REQUEST = [
  'authorization',
  'content-type',
  'cookie',
  'idempotency-key',
  'if-match',
  'if-none-match',
  'x-tenant-id',
  'x-request-id',
  'traceparent',
  'accept',
];
const FORWARD_RESPONSE = [
  'content-type',
  'etag',
  'idempotent-replayed',
  'retry-after',
  'x-request-id',
  'traceparent',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'cache-control',
];

export function apiBase(): string {
  return (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4100').replace(/\/$/, '');
}

export async function proxyRequest(
  request: Request,
  path: string[],
  extra: Record<string, string> = {},
): Promise<Response> {
  const incoming = new URL(request.url);
  const target = `${apiBase()}/${path.map(encodeURIComponent).join('/')}${incoming.search}`;
  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });
  const responseHeaders = new Headers();
  for (const name of FORWARD_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);
  const body = upstream.status === 204 || upstream.status === 304 ? null : await upstream.arrayBuffer();
  return new Response(body, { status: upstream.status, headers: responseHeaders });
}
