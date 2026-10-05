import type { Metadata } from 'next';
import { CheckoutView } from '@/components/checkout-view';
import { TrackView } from '@/components/track-view';

export const metadata: Metadata = { title: 'Checkout' };

export default function CheckoutPage() {
  return (
    <div className="space-y-6">
      <TrackView events={[{ type: 'page_viewed', props: { page_type: 'checkout' } }]} />
      <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
      <CheckoutView />
    </div>
  );
}
