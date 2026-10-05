import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { AppProviders } from '@/lib/session';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <Shell>{children}</Shell>
    </AppProviders>
  );
}
