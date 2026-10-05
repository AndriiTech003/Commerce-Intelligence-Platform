export const WEBHOOK_REPOSITORY = Symbol('WEBHOOK_REPOSITORY');

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  secret: string;
  secretPrefix: string;
  status: 'active' | 'disabled';
  description: string | null;
  createdAt: Date;
  disabledAt: Date | null;
  lastDeliveryAt: Date | null;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  status: 'pending' | 'succeeded' | 'failed' | 'dead';
  attempts: number;
  nextAttemptAt: Date | null;
  lastStatusCode: number | null;
  lastError: string | null;
  durationMs: number | null;
  createdAt: Date;
  deliveredAt: Date | null;
  payload: Record<string, unknown>;
}

export interface WebhookRepository {
  list(): Promise<WebhookEndpoint[]>;
  find(id: string): Promise<WebhookEndpoint | null>;
  insert(
    endpoint: Omit<WebhookEndpoint, 'createdAt' | 'disabledAt' | 'lastDeliveryAt'>,
  ): Promise<WebhookEndpoint>;
  update(
    id: string,
    patch: Partial<Pick<WebhookEndpoint, 'url' | 'events' | 'status' | 'description' | 'disabledAt'>>,
  ): Promise<WebhookEndpoint | null>;
  remove(id: string): Promise<boolean>;
  deliveries(endpointId: string, limit: number): Promise<WebhookDelivery[]>;
  findDelivery(id: string): Promise<WebhookDelivery | null>;
  resend(id: string): Promise<WebhookDelivery | null>;
}
