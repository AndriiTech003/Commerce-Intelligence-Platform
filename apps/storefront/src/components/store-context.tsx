'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { StoreInfo } from '@/lib/types';

const StoreContext = createContext<StoreInfo | null>(null);

export function StoreProvider({ store, children }: { store: StoreInfo; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreInfo {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
}
