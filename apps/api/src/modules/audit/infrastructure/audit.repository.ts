import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { auditLog, users } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { AuditEntry } from '../domain/audit';
import type { AuditQuery, AuditRepository } from '../application/ports';

@Injectable()
export class DrizzleAuditRepository implements AuditRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async insert(entries: Array<Omit<AuditEntry, 'createdAt'>>) {
    if (entries.length === 0) return;
    await this.db
      .tx()
      .insert(auditLog)
      .values(entries.map((e) => ({ ...e, tenantId: this.db.tenantId() })));
  }

  async list(query: AuditQuery) {
    const conditions: SQL[] = [];
    if (query.actorId) conditions.push(eq(auditLog.actorId, query.actorId));
    if (query.entityType) conditions.push(eq(auditLog.entityType, query.entityType));
    if (query.entityId) conditions.push(eq(auditLog.entityId, query.entityId));
    if (query.action) conditions.push(eq(auditLog.action, query.action));
    if (query.from) conditions.push(gte(auditLog.createdAt, new Date(query.from)));
    if (query.to) conditions.push(lte(auditLog.createdAt, new Date(query.to)));
    if (query.cursor) {
      conditions.push(
        sql`(${auditLog.createdAt}, ${auditLog.id}) < (${String(query.cursor.v)}::timestamptz, ${query.cursor.id}::uuid)`,
      );
    }
    const rows = await this.db
      .tx()
      .select({
        id: auditLog.id,
        actorType: auditLog.actorType,
        actorId: auditLog.actorId,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        diff: auditLog.diff,
        ip: auditLog.ip,
        createdAt: auditLog.createdAt,
        actorName: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(query.limit + 1);
    return rows;
  }
}
