export const JOB_REPOSITORY = Symbol('JOB_REPOSITORY');

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  total: number;
  processed: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
  result: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface JobRepository {
  insert(job: {
    id: string;
    type: string;
    status: JobStatus;
    total: number;
    createdBy: string | null;
  }): Promise<void>;
  find(id: string): Promise<Job | null>;
  update(
    id: string,
    patch: Partial<
      Pick<Job, 'status' | 'total' | 'processed' | 'failed' | 'errors' | 'result' | 'finishedAt'>
    >,
  ): Promise<void>;
}
