import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INSUFFICIENT_STOCK',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_IN_PROGRESS',
  'PRECONDITION_FAILED',
  'PRECONDITION_REQUIRED',
  'INVALID_TRANSITION',
  'DISCOUNT_INVALID',
  'CART_EMPTY',
  'RATE_LIMITED',
  'INVALID_SIGNATURE',
  'PAYMENT_FAILED',
  'TENANT_NOT_FOUND',
  'REFRESH_TOKEN_REUSED',
  'INVALID_CREDENTIALS',
  'SERVICE_UNAVAILABLE',
  'FEATURE_DISABLED',
  'LLM_LIMIT_EXCEEDED',
  'LLM_UNAVAILABLE',
  'LLM_INVALID_OUTPUT',
  'APPROVAL_BLOCKED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  traceId: z.string().optional(),
  errors: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type Problem = z.infer<typeof problemSchema>;

export function problemType(code: string): string {
  return `https://docs.cip.dev/errors/${code.toLowerCase().replace(/_/g, '-')}`;
}
