import { ApiError } from '@cip/api-client';

export interface StockIssue {
  variantId: string;
  requested: number | null;
  available: number | null;
}

export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function stockIssues(error: unknown): StockIssue[] {
  if (!(error instanceof ApiError) || error.code !== 'INSUFFICIENT_STOCK') return [];
  return (error.problem.errors ?? [])
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      variantId: String(entry.variantId ?? ''),
      requested: num(entry.requested),
      available: num(entry.available),
    }));
}
