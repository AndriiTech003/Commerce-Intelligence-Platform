import type { Metadata } from 'next';
import { AccountView } from '@/components/account-view';

export const metadata: Metadata = { title: 'Account', robots: { index: false } };

export default function AccountPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Your account</h1>
      <AccountView />
    </div>
  );
}
