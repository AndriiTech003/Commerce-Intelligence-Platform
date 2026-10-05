import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Permission } from '@cip/contracts';
import { apiKeys } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { ApiKeyKind, ApiKeyRecord } from '../domain/api-key';
import type { ApiKeyRepository } from '../application/ports';

function toRecord(row: typeof apiKeys.$inferSelect): ApiKeyRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind as ApiKeyKind,
    prefix: row.prefix,
    scopes: row.scopes as Permission[],
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

@Injectable()
export class DrizzleApiKeyRepository implements ApiKeyRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async create(row: {
    id: string;
    kind: ApiKeyKind;
    prefix: string;
    keyHash: string;
    scopes: Permission[];
    createdBy: string | null;
  }) {
    const [created] = await this.db
      .tx()
      .insert(apiKeys)
      .values({ ...row, tenantId: this.db.tenantId() })
      .returning();
    return toRecord(created!);
  }

  async list() {
    const rows = await this.db.tx().select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
    return rows.map(toRecord);
  }

  async revoke(id: string) {
    const [row] = await this.db
      .tx()
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ keyHash: apiKeys.keyHash });
    return row ?? null;
  }

  async findActiveByHash(hash: string) {
    const [row] = await this.db.system
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async touch(id: string) {
    await this.db.system
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, id),
          or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, sql`now() - interval '1 minute'`)),
        ),
      );
  }
}
