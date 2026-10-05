import type { Job } from './types';

export function isJobDone(job: Pick<Job, 'status'> | undefined): boolean {
  return job?.status === 'completed' || job?.status === 'failed';
}

export function jobProgress(job: Pick<Job, 'processed' | 'total' | 'status'> | undefined): number {
  if (!job) return 0;
  if (job.status === 'completed') return 100;
  if (job.total <= 0) return 0;
  return Math.min(100, Math.round((job.processed / job.total) * 100));
}
