export interface OrderMailData {
  number: number;
  email: string;
  totalCents: number;
  currency: string;
  storeName: string;
  storeUrl: string;
  orderId: string;
  items: Array<{ title: string; quantity: number; unitPriceCents: number }>;
}

export function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function itemLines(data: OrderMailData): string {
  return data.items
    .map((i) => `  ${i.quantity} × ${i.title} — ${money(i.unitPriceCents * i.quantity, data.currency)}`)
    .join('\n');
}

export type OrderMailKind = 'order.paid' | 'order.fulfilled' | 'order.refunded' | 'order.cancelled';

export function orderMail(kind: OrderMailKind, data: OrderMailData, extra: { reason?: string } = {}) {
  const link = `${data.storeUrl}/orders/${data.orderId}`;
  const total = money(data.totalCents, data.currency);
  switch (kind) {
    case 'order.paid':
      return {
        subject: `${data.storeName}: payment received for order #${data.number}`,
        text: `Thank you! We received your payment of ${total} for order #${data.number}.\n\n${itemLines(data)}\n\nTrack your order: ${link}`,
      };
    case 'order.fulfilled':
      return {
        subject: `${data.storeName}: order #${data.number} has shipped`,
        text: `Good news: order #${data.number} is on its way.\n\n${itemLines(data)}\n\nDetails: ${link}`,
      };
    case 'order.refunded':
      return {
        subject: `${data.storeName}: refund for order #${data.number}`,
        text: `We refunded ${total} for order #${data.number}. It can take a few days to appear on your statement.`,
      };
    case 'order.cancelled':
      return {
        subject: `${data.storeName}: order #${data.number} was cancelled`,
        text: `Order #${data.number} was cancelled${extra.reason === 'payment_timeout' ? ' because the payment was not completed in time' : ''}.`,
      };
  }
}

export function lowStockMail(input: {
  storeName: string;
  sku: string;
  title: string;
  available: number;
  threshold: number;
}) {
  return {
    subject: `${input.storeName}: low stock for ${input.sku}`,
    text: `${input.title} (${input.sku}) has ${input.available} units available, at or below the threshold of ${input.threshold}.`,
  };
}
