import { createApiClient, unwrap, ApiError, toApiError } from '@cip/api-client';

export interface Membership {
  tenantId: string;
  slug: string;
  name: string;
  role: string;
  permissions: string[];
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
}

export interface AuthPayload {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
  memberships: Membership[];
}

const state: { token: string | null; tenantId: string | null; onLogout: (() => void) | null } = {
  token: null,
  tenantId: null,
  onLogout: null,
};

export function setAccessToken(token: string | null): void {
  state.token = token;
}

export function setTenant(tenantId: string | null): void {
  state.tenantId = tenantId;
}

export function currentTenant(): string | null {
  return state.tenantId;
}

export function onLogout(handler: () => void): void {
  state.onLogout = handler;
}

export async function refreshSession(): Promise<AuthPayload | null> {
  const response = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!response.ok) {
    state.token = null;
    return null;
  }
  const body = (await response.json()) as AuthPayload;
  state.token = body.accessToken;
  return body;
}

function origin(): string {
  return typeof window === 'undefined' ? 'http://127.0.0.1' : window.location.origin;
}

export const api = createApiClient({
  baseUrl: `${origin()}/api`,
  getToken: () => state.token,
  headers: () => ({ 'x-tenant-id': state.tenantId ?? undefined }),
  refresh: async () => {
    const session = await refreshSession();
    if (!session) state.onLogout?.();
    return session?.accessToken ?? null;
  },
});

export { unwrap, ApiError };

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

export function newIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID()}`;
}

export function problemDetails(error: unknown): string[] {
  if (!(error instanceof ApiError)) return [];
  return (error.problem.errors ?? []).map((item) => {
    const message = typeof item.message === 'string' ? item.message : null;
    const path = typeof item.path === 'string' ? item.path : null;
    if (message && path) return `${path}: ${message}`;
    if (message) return message;
    if (typeof item.flag === 'string') return `flag: ${item.flag}`;
    return JSON.stringify(item);
  });
}

export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (state.tenantId) headers.set('x-tenant-id', state.tenantId);
    return fetch(`${origin()}/api${path}`, { ...init, headers, credentials: 'include' });
  };
  const response = await send(state.token);
  if (response.status !== 401) return response;
  const session = await refreshSession();
  if (!session) {
    state.onLogout?.();
    return response;
  }
  return send(session.accessToken);
}

export async function postText<T>(path: string, body: string, contentType: string): Promise<T> {
  const response = await apiFetch(path, { method: 'POST', body, headers: { 'content-type': contentType } });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!response.ok) throw toApiError(response.status, parsed);
  return parsed as T;
}
