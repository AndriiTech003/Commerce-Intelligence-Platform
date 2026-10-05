import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { jobs } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { Job, JobRepository, JobStatus } from '../application/ports';

@Injectable()
export class DrizzleJobRepository implements JobRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async insert(job: {
    id: string;
    type: string;
    status: JobStatus;
    total: number;
    createdBy: string | null;
  }) {
    await this.db
      .tx()
      .insert(jobs)
      .values({ ...job, tenantId: this.db.tenantId() });
  }

  async find(id: string): Promise<Job | null> {
    const [row] = await this.db.tx().select().from(jobs).where(eq(jobs.id, id)).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      status: row.status as JobStatus,
      total: row.total,
      processed: row.processed,
      failed: row.failed,
      errors: row.errors,
      result: row.result ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
    };
  }

  async update(id: string, patch: Partial<Job>) {
    if (Object.keys(patch).length === 0) return;
    await this.db.tx().update(jobs).set(patch).where(eq(jobs.id, id));
  }
}
