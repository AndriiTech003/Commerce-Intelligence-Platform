import type { AuditEntry } from '../domain/audit';

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

export interface AuditQuery {
  actorId?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  action?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit: number;
  cursor?: { v: string | number; id: string } | null;
}

export interface AuditRepository {
  insert(entries: Array<Omit<AuditEntry, 'createdAt'>>): Promise<void>;
  list(query: AuditQuery): Promise<Array<AuditEntry & { actorName: string | null }>>;
}
