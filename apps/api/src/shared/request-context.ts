import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission } from '@cip/contracts';

export type ActorType = 'user' | 'api_key' | 'customer' | 'system' | 'anonymous';

export interface Actor {
  type: ActorType;
  id: string | null;
  permissions: Permission[];
  role?: string;
  isPlatformAdmin?: boolean;
  email?: string;
}

export interface AuditRecord {
  action?: string;
  entityType?: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface RequestContext {
  requestId: string;
  ip: string | null;
  tenantId: string | null;
  tenantSlug?: string | null;
  actor: Actor | null;
  anonymousId: string | null;
  audit: AuditRecord[];
  tx?: unknown;
  txTenantId?: string | null;
  txUserId?: string | null;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function newContext(partial: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: partial.requestId ?? 'internal',
    ip: partial.ip ?? null,
    tenantId: partial.tenantId ?? null,
    actor: partial.actor ?? null,
    anonymousId: partial.anonymousId ?? null,
    audit: partial.audit ?? [],
    ...partial,
  };
}

export function currentContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContext.run(ctx, fn);
}
