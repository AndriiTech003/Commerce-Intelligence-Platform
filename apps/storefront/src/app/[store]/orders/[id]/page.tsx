import type { Metadata } from 'next';
import { OrderStatusView } from '@/components/order-status-view';

export const metadata: Metadata = { title: 'Order status', robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ store: string; id: string }> }) {
  const { id } = await params;
  return <OrderStatusView id={id} />;
}
