'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { StoreInfo } from '@/lib/types';
import { StoreProvider } from './store-context';
import { TrackerProvider } from './tracker-provider';
import { CustomerProvider } from './customer-provider';

export function Providers({ store, children }: { store: StoreInfo; children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15000, retry: 1, refetchOnWindowFocus: false },
          mutations: { retry: 0 },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <StoreProvider store={store}>
        <TrackerProvider trackingKey={store.trackingKey} collectorUrl={store.collectorUrl}>
          <CustomerProvider>{children}</CustomerProvider>
        </TrackerProvider>
      </StoreProvider>
    </QueryClientProvider>
  );
}
