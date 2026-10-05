export interface AuditEntry {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  diff: Record<string, [unknown, unknown]> | null;
  ip: string | null;
  createdAt: Date;
}

export function entityIdFrom(params: Record<string, string>, body: unknown): string | null {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const key of ['id', 'userId', 'variantId']) {
    const value = params[key];
    if (value && uuid.test(value)) return value;
  }
  if (body && typeof body === 'object') {
    for (const key of ['id', 'orderId', 'productId']) {
      const value = (body as Record<string, unknown>)[key];
      if (typeof value === 'string' && uuid.test(value)) return value;
    }
  }
  return null;
}
