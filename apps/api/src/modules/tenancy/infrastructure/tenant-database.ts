import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { ApiConfig } from '../../../config';
import * as schema from '../../../db/schema';
import { DomainError } from '../../../shared/errors';
import { currentContext, newContext, runWithContext } from '../../../shared/request-context';
import { CONFIG } from '../../../shared/tokens';
import type { UnitOfWork } from '../application/ports';

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export class TenantContextMissingError extends DomainError {
  constructor() {
    super('INTERNAL', 500, 'Tenant context is not set for this operation');
  }
}

export class TransactionMissingError extends DomainError {
  constructor() {
    super('INTERNAL', 500, 'No active transaction; wrap the call in UnitOfWork.run()');
  }
}

@Injectable()
export class TenantDatabase implements UnitOfWork, OnApplicationShutdown {
  readonly appPool: pg.Pool;
  readonly systemPool: pg.Pool;
  readonly app: Database;
  readonly system: Database;

  constructor(@Inject(CONFIG) config: ApiConfig) {
    this.appPool = new pg.Pool({ connectionString: config.DATABASE_URL, max: config.DATABASE_POOL_SIZE });
    this.systemPool = new pg.Pool({ connectionString: config.DATABASE_SYSTEM_URL, max: 5 });
    this.appPool.on('error', () => undefined);
    this.systemPool.on('error', () => undefined);
    this.app = drizzle(this.appPool, { schema });
    this.system = drizzle(this.systemPool, { schema });
  }

  async withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const store = currentContext();
    if (store?.tx && store.txTenantId === tenantId) return fn(store.tx as Tx);
    return this.app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      const ctx = { ...(store ?? newContext()), tx, txTenantId: tenantId, txUserId: null, tenantId };
      return runWithContext(ctx, () => fn(tx));
    });
  }

  async withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const store = currentContext();
    if (store?.tx && store.txUserId === userId && !store.txTenantId) return fn(store.tx as Tx);
    return this.app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
      const ctx = { ...(store ?? newContext()), tx, txTenantId: null, txUserId: userId };
      return runWithContext(ctx, () => fn(tx));
    });
  }

  async withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const store = currentContext();
    return this.system.transaction(async (tx) => {
      const ctx = { ...(store ?? newContext()), tx, txTenantId: null, txUserId: null };
      return runWithContext(ctx, () => fn(tx as unknown as Tx));
    });
  }

  async withGlobal<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const store = currentContext();
    if (store?.tx) return fn(store.tx as Tx);
    return this.app.transaction(async (tx) => {
      const ctx = { ...(store ?? newContext()), tx, txTenantId: null, txUserId: null };
      return runWithContext(ctx, () => fn(tx));
    });
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    const tenantId = currentContext()?.tenantId;
    if (!tenantId) throw new TenantContextMissingError();
    return this.withTenant(tenantId, () => fn());
  }

  runForTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return this.withTenant(tenantId, () => fn());
  }

  runForUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    return this.withUser(userId, () => fn());
  }

  runSystem<T>(fn: () => Promise<T>): Promise<T> {
    return this.withSystem(() => fn());
  }

  tx(): Tx {
    const tx = currentContext()?.tx;
    if (!tx) throw new TransactionMissingError();
    return tx as Tx;
  }

  executor(): Database | Tx {
    const tx = currentContext()?.tx;
    return (tx as Tx | undefined) ?? this.app;
  }

  tenantId(): string {
    const store = currentContext();
    const tenantId = store?.txTenantId ?? store?.tenantId;
    if (!tenantId) throw new TenantContextMissingError();
    return tenantId;
  }

  async ping(): Promise<void> {
    await this.appPool.query('select 1');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.appPool.end().catch(() => undefined);
    await this.systemPool.end().catch(() => undefined);
  }
}
