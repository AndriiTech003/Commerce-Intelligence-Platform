'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@cip/api-client';
import { api, onSessionChange, refreshSession, setSession } from '@/lib/browser-api';
import type { AuthSession, Customer } from '@/lib/types';
import { useTracker } from './tracker-provider';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface CustomerApi {
  customer: Customer | null;
  status: Status;
  login: (email: string, password: string) => Promise<Customer>;
  register: (email: string, password: string, name: string) => Promise<Customer>;
  logout: () => Promise<void>;
}

const CustomerContext = createContext<CustomerApi | null>(null);

export function CustomerProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const queryClient = useQueryClient();
  const tracker = useTracker();

  useEffect(() => {
    const unsubscribe = onSessionChange((session) => {
      setCustomer(session?.customer ?? null);
      setStatus(session ? 'authenticated' : 'anonymous');
    });
    void refreshSession().then((session) => {
      setCustomer(session?.customer ?? null);
      setStatus(session ? 'authenticated' : 'anonymous');
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    tracker.identify(customer?.id);
  }, [tracker, customer?.id]);

  const accept = useCallback(
    async (session: AuthSession) => {
      setSession(session);
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
      await queryClient.invalidateQueries({ queryKey: ['account'] });
      return session.customer;
    },
    [queryClient],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const session = unwrap(await api().POST('/v1/storefront/auth/login', { body: { email, password } }));
      return accept(session as AuthSession);
    },
    [accept],
  );

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      const session = unwrap(
        await api().POST('/v1/storefront/auth/register', { body: { email, password, name } }),
      );
      return accept(session as AuthSession);
    },
    [accept],
  );

  const logout = useCallback(async () => {
    try {
      await api().POST('/v1/storefront/auth/logout');
    } finally {
      setSession(null);
      queryClient.removeQueries({ queryKey: ['account'] });
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
    }
  }, [queryClient]);

  const value = useMemo(
    () => ({ customer, status, login, register, logout }),
    [customer, status, login, register, logout],
  );
  return <CustomerContext.Provider value={value}>{children}</CustomerContext.Provider>;
}

export function useCustomer(): CustomerApi {
  const value = useContext(CustomerContext);
  if (!value) throw new Error('useCustomer must be used inside CustomerProvider');
  return value;
}
