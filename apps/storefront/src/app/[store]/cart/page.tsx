import type { Metadata } from 'next';
import { CartView } from '@/components/cart-view';
import { TrackView } from '@/components/track-view';

export const metadata: Metadata = { title: 'Cart' };

export default function CartPage() {
  return (
    <div className="space-y-6">
      <TrackView events={[{ type: 'page_viewed', props: { page_type: 'cart' } }]} />
      <h1 className="text-2xl font-bold tracking-tight">Your cart</h1>
      <CartView />
    </div>
  );
}
