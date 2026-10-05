export function tenantFromChannel(
  channel: string,
  prefix: string,
): { tenantId: string; kind: 'tick' | 'events' } | null {
  if (!channel.startsWith(prefix)) return null;
  const match = /^rt:([0-9a-f-]{36}):(tick|events)$/.exec(channel.slice(prefix.length));
  return match ? { tenantId: match[1]!, kind: match[2] as 'tick' | 'events' } : null;
}

export interface TicketPayload {
  tenantId: string;
  userId: string;
}

export function parseTicket(raw: string | null): TicketPayload | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TicketPayload>;
    return typeof value.tenantId === 'string' && typeof value.userId === 'string'
      ? { tenantId: value.tenantId, userId: value.userId }
      : null;
  } catch {
    return null;
  }
}
