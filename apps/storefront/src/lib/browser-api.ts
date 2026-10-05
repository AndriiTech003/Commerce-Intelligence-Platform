import { createApiClient, type ApiClient } from '@cip/api-client';
import type { AuthSession } from './types';

let accessToken: string | null = null;
let client: ApiClient | null = null;
let inflight: Promise<AuthSession | null> | null = null;
const listeners = new Set<(session: AuthSession | null) => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setSession(session: AuthSession | null): void {
  accessToken = session?.accessToken ?? null;
  for (const listener of listeners) listener(session);
}

export function onSessionChange(listener: (session: AuthSession | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function origin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
}

export function refreshSession(): Promise<AuthSession | null> {
  inflight ??= fetch(`${origin()}/api/v1/storefront/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
    .then(async (response) => {
      if (!response.ok || response.status === 204) {
        setSession(null);
        return null;
      }
      const session = (await response.json()) as AuthSession;
      setSession(session);
      return session;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function api(): ApiClient {
  client ??= createApiClient({
    baseUrl: `${origin()}/api`,
    credentials: 'include',
    getToken: getAccessToken,
    refresh: async () => (await refreshSession())?.accessToken ?? null,
  });
  return client;
}
