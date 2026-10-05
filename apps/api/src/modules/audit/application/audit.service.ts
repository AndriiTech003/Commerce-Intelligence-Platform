import { Inject, Injectable } from '@nestjs/common';
import { decodeCursor, encodeCursor, uuidv7 } from '@cip/contracts';
import { diffObjects } from '../../../shared/diff';
import type { AuditRecord, RequestContext } from '../../../shared/request-context';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import { AUDIT_REPOSITORY, type AuditQuery, type AuditRepository } from './ports';

@Injectable()
export class AuditService {
  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly repo: AuditRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async write(
    ctx: RequestContext,
    defaults: { action: string; entityType: string; entityId: string | null },
    records: AuditRecord[],
  ): Promise<void> {
    if (!ctx.tenantId) return;
    const list = records.length > 0 ? records : [{}];
    const entries = list.map((record) => {
      const diff =
        record.before !== undefined || record.after !== undefined
          ? diffObjects(record.before ?? null, record.after ?? null)
          : null;
      return {
        id: uuidv7(),
        actorType: ctx.actor?.type === 'api_key' ? 'api_key' : ctx.actor?.type === 'user' ? 'user' : 'system',
        actorId: ctx.actor?.id ?? null,
        action: record.action ?? defaults.action,
        entityType: record.entityType ?? defaults.entityType,
        entityId: record.entityId ?? defaults.entityId,
        diff: diff && Object.keys(diff).length > 0 ? diff : null,
        ip: ctx.ip,
      };
    });
    await this.uow.runForTenant(ctx.tenantId, () => this.repo.insert(entries));
  }

  async list(query: Omit<AuditQuery, 'cursor'> & { cursor?: string | undefined }) {
    const rows = await this.uow.run(() => this.repo.list({ ...query, cursor: decodeCursor(query.cursor) }));
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      data: page.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ v: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }
}
