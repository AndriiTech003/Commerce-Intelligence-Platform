import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';

export type { paths, components };
export type ApiClient = Client<paths>;

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  traceId?: string;
  errors?: Array<Record<string, unknown>>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.problem.code;
  }
}

export function toApiError(status: number, body: unknown): ApiError {
  const problem =
    body && typeof body === 'object' && 'code' in (body as Record<string, unknown>)
      ? (body as Problem)
      : {
          type: 'about:blank',
          title: 'Request failed',
          status,
          code: 'INTERNAL',
          detail: typeof body === 'string' ? body : undefined,
        };
  return new ApiError(status, problem as Problem);
}

export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok)
    throw toApiError(result.response.status, result.error);
  return result.data as T;
}

export interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  credentials?: RequestCredentials;
  headers?: () => Record<string, string | undefined>;
  getToken?: () => string | null | undefined;
  refresh?: () => Promise<string | null>;
}

const SKIP_REFRESH = /\/v1\/(auth|storefront\/auth)\/(login|refresh|signup|register|logout)$/;

export function authMiddleware(
  options: Pick<ClientOptions, 'getToken' | 'refresh' | 'headers'> & { fetch?: typeof fetch },
): Middleware {
  const clones = new WeakMap<Request, Request>();
  let inflight: Promise<string | null> | null = null;
  const refreshOnce = () => {
    if (!options.refresh) return Promise.resolve(null);
    inflight ??= options.refresh().finally(() => {
      inflight = null;
    });
    return inflight;
  };
  return {
    async onRequest({ request }) {
      const token = options.getToken?.();
      if (token) request.headers.set('authorization', `Bearer ${token}`);
      for (const [name, value] of Object.entries(options.headers?.() ?? {})) {
        if (value) request.headers.set(name, value);
      }
      if (options.refresh) clones.set(request, request.clone());
      return request;
    },
    async onResponse({ request, response }) {
      if (response.status !== 401 || !options.refresh || SKIP_REFRESH.test(new URL(request.url).pathname))
        return response;
      const retry = clones.get(request);
      if (!retry) return response;
      const token = await refreshOnce();
      if (!token) return response;
      retry.headers.set('authorization', `Bearer ${token}`);
      return (options.fetch ?? fetch)(retry);
    },
  };
}

export function createApiClient(options: ClientOptions): ApiClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    credentials: options.credentials ?? 'include',
  });
  client.use(authMiddleware(options));
  return client;
}
