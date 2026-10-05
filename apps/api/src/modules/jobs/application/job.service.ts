import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@cip/contracts';
import { NotFoundError } from '../../../shared/errors';
import { currentContext } from '../../../shared/request-context';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import { JOB_REPOSITORY, type Job, type JobRepository, type JobStatus } from './ports';

export const MAX_JOB_ERRORS = 500;

@Injectable()
export class JobService {
  constructor(
    @Inject(JOB_REPOSITORY) private readonly repo: JobRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  view(job: Job) {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      total: job.total,
      processed: job.processed,
      failed: job.failed,
      errors: job.errors,
      result: job.result,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }

  async create(type: string, total: number, status: JobStatus = 'queued'): Promise<string> {
    const id = uuidv7();
    const actor = currentContext()?.actor;
    await this.uow.run(() =>
      this.repo.insert({ id, type, status, total, createdBy: actor?.type === 'user' ? actor.id : null }),
    );
    return id;
  }

  async get(id: string) {
    const job = await this.uow.run(() => this.repo.find(id));
    if (!job) throw new NotFoundError('Job', id);
    return this.view(job);
  }

  update(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<Job, 'status' | 'total' | 'processed' | 'failed' | 'errors' | 'result' | 'finishedAt'>
    >,
  ): Promise<void> {
    const trimmed = patch.errors ? { ...patch, errors: patch.errors.slice(0, MAX_JOB_ERRORS) } : patch;
    return this.uow.runForTenant(tenantId, () => this.repo.update(id, trimmed));
  }
}
