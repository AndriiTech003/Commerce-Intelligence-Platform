export const EXCHANGES = {
  track: 'track',
  domain: 'domain',
  retry: 'retry',
  dlx: 'dlx',
} as const;

export const RETRY_DELAYS = ['5s', '30s', '5m'] as const;
export type RetryDelay = (typeof RETRY_DELAYS)[number];
export const RETRY_DELAY_MS: Record<RetryDelay, number> = { '5s': 5000, '30s': 30000, '5m': 300000 };

export interface QueueSpec {
  name: string;
  bindings: Array<{ exchange: 'track' | 'domain'; pattern: string }>;
  consumer: string;
  prefetch: number;
}

export const QUEUES: QueueSpec[] = [
  {
    name: 'analytics.ingest',
    bindings: [
      { exchange: 'track', pattern: '#' },
      { exchange: 'domain', pattern: 'order.#' },
    ],
    consumer: 'stream-worker',
    prefetch: 1000,
  },
  {
    name: 'realtime.counters',
    bindings: [
      { exchange: 'track', pattern: '#' },
      { exchange: 'domain', pattern: 'order.paid' },
    ],
    consumer: 'stream-worker',
    prefetch: 200,
  },
  {
    name: 'profile.update',
    bindings: [
      { exchange: 'track', pattern: 'product_viewed' },
      { exchange: 'track', pattern: 'cart_item_added' },
      { exchange: 'track', pattern: 'cart_item_removed' },
      { exchange: 'track', pattern: 'search_performed' },
      { exchange: 'track', pattern: 'ad_clicked' },
      { exchange: 'domain', pattern: 'order.placed' },
      { exchange: 'domain', pattern: 'order.refunded' },
      { exchange: 'domain', pattern: 'customer.identified' },
    ],
    consumer: 'stream-worker',
    prefetch: 200,
  },
  {
    name: 'bandit.feedback',
    bindings: [
      { exchange: 'track', pattern: 'ad_impression' },
      { exchange: 'track', pattern: 'ad_clicked' },
      { exchange: 'domain', pattern: 'order.placed' },
      { exchange: 'domain', pattern: 'creative.approved' },
    ],
    consumer: 'api',
    prefetch: 200,
  },
  {
    name: 'notifications',
    bindings: [
      { exchange: 'domain', pattern: 'order.*' },
      { exchange: 'domain', pattern: 'inventory.low_stock' },
    ],
    consumer: 'domain-worker',
    prefetch: 20,
  },
  {
    name: 'catalog.embeddings',
    bindings: [{ exchange: 'domain', pattern: 'product.upserted' }],
    consumer: 'domain-worker',
    prefetch: 20,
  },
  {
    name: 'reco.cooccurrence',
    bindings: [
      { exchange: 'track', pattern: 'product_viewed' },
      { exchange: 'domain', pattern: 'order.placed' },
    ],
    consumer: 'stream-worker',
    prefetch: 200,
  },
  {
    name: 'decisions.log',
    bindings: [{ exchange: 'domain', pattern: 'decision.made' }],
    consumer: 'stream-worker',
    prefetch: 1000,
  },
  {
    name: 'webhooks.outgoing',
    bindings: [
      { exchange: 'domain', pattern: 'order.paid' },
      { exchange: 'domain', pattern: 'order.refunded' },
    ],
    consumer: 'domain-worker',
    prefetch: 20,
  },
];

export const DELIVERY_LIMIT = 10;

export function queueName(name: string): string {
  return `q.${name}`;
}

export function retryQueueName(name: string, delay: RetryDelay): string {
  return `q.${name}.retry.${delay}`;
}

export function dlqName(name: string): string {
  return `q.${name}.dlq`;
}

export function dlqNames(): string[] {
  return QUEUES.map((q) => dlqName(q.name));
}

export function logicalNameFromDlq(dlq: string): string | null {
  const match = /^q\.(.+)\.dlq$/.exec(dlq);
  return match && QUEUES.some((q) => q.name === match[1]) ? (match[1] ?? null) : null;
}

export const MESSAGE_HEADERS = {
  traceparent: 'traceparent',
  tenantId: 'tenant_id',
  eventType: 'event_type',
  schemaVersion: 'schema_version',
  retryCount: 'x-retry-count',
  error: 'x-error',
  errorKind: 'x-error-kind',
  originalQueue: 'x-original-queue',
  failedAt: 'x-failed-at',
} as const;
