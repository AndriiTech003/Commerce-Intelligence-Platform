import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, unwrap } from '../../src';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('api client', () => {
  it('adds auth and tenant headers', async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.headers.get('authorization')).toBe('Bearer t1');
      expect(request.headers.get('x-tenant-id')).toBe('tenant');
      return json(200, { user: { id: 'u' }, memberships: [] });
    });
    const client = createApiClient({
      baseUrl: 'http://api',
      fetch: fetchMock as unknown as typeof fetch,
      getToken: () => 't1',
      headers: () => ({ 'x-tenant-id': 'tenant' }),
    });
    const me = unwrap(await client.GET('/v1/me'));
    expect(me.user.id).toBe('u');
  });

  it('refreshes once for concurrent 401s and retries', async () => {
    let token = 'old';
    let refreshes = 0;
    const fetchMock = vi.fn(async (request: Request) =>
      request.headers.get('authorization') === 'Bearer new'
        ? json(200, { data: [] })
        : json(401, { code: 'UNAUTHORIZED' }),
    );
    const client = createApiClient({
      baseUrl: 'http://api',
      fetch: fetchMock as unknown as typeof fetch,
      getToken: () => token,
      refresh: async () => {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 10));
        token = 'new';
        return token;
      },
    });
    const results = await Promise.all([
      client.GET('/v1/admin/members'),
      client.GET('/v1/admin/members'),
      client.GET('/v1/admin/members'),
    ]);
    expect(results.every((r) => r.response.status === 200)).toBe(true);
    expect(refreshes).toBe(1);
  });

  it('turns problem details into ApiError', async () => {
    const client = createApiClient({
      baseUrl: 'http://api',
      fetch: (async () =>
        json(409, {
          type: 'x',
          title: 'Conflict',
          status: 409,
          code: 'INSUFFICIENT_STOCK',
          detail: 'no',
        })) as unknown as typeof fetch,
    });
    const result = await client.GET('/v1/me');
    expect(() => unwrap(result)).toThrow(ApiError);
    try {
      unwrap(result);
    } catch (error) {
      expect((error as ApiError).code).toBe('INSUFFICIENT_STOCK');
    }
  });
});
