'use client';

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  onLogout,
  refreshSession,
  setAccessToken,
  setTenant,
  type AuthPayload,
  type Membership,
  type SessionUser,
} from './api';

interface SessionValue {
  user: SessionUser;
  memberships: Membership[];
  tenant: Membership | null;
  switchTenant: (tenantId: string) => void;
  can: (permission: string) => boolean;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);
const TENANT_KEY = 'cip_tenant';

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export function useTenantId(): string | null {
  return useSession().tenant?.tenantId ?? null;
}

function storedTenant(): string | null {
  try {
    return window.localStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
}

function SessionGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<AuthPayload | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((payload: AuthPayload) => {
    setSession(payload);
    const preferred = storedTenant();
    const chosen =
      payload.memberships.find((m) => m.tenantId === preferred) ?? payload.memberships[0] ?? null;
    setTenant(chosen?.tenantId ?? null);
    setTenantId(chosen?.tenantId ?? null);
  }, []);

  const reload = useCallback(async () => {
    const payload = await refreshSession();
    if (!payload) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    apply(payload);
  }, [apply, router]);

  useEffect(() => {
    onLogout(() => router.replace('/login'));
    void reload().finally(() => setLoading(false));
  }, [reload, router]);

  const value = useMemo<SessionValue | null>(() => {
    if (!session) return null;
    const tenant = session.memberships.find((m) => m.tenantId === tenantId) ?? null;
    return {
      user: session.user,
      memberships: session.memberships,
      tenant,
      can: (permission) => tenant?.permissions.includes(permission) ?? false,
      switchTenant: (id) => {
        try {
          window.localStorage.setItem(TENANT_KEY, id);
        } catch {
          return;
        }
        setTenant(id);
        queryClient.clear();
        setTenantId(id);
      },
      logout: async () => {
        await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
        setAccessToken(null);
        queryClient.clear();
        router.replace('/login');
      },
      reload,
    };
  }, [session, tenantId, queryClient, router, reload]);

  if (loading || !value) {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-sm text-slate-500 dark:text-slate-400"
        data-testid="session-loading"
      >
        Loading…
      </div>
    );
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <SessionGate>{children}</SessionGate>
    </QueryClientProvider>
  );
}

export function PublicProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
