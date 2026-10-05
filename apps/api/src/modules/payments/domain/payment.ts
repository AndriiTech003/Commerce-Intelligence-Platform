import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../../../shared/errors';

export type PaymentStatus = 'requires_action' | 'processing' | 'succeeded' | 'failed' | 'refunded';

export interface WebhookEvent {
  eventId: string;
  kind: 'succeeded' | 'failed' | 'ignored';
  intentId: string | null;
  tenantId: string | null;
  amountCents: number | null;
}

export class InvalidSignatureError extends DomainError {
  constructor(message = 'Webhook signature is invalid') {
    super('INVALID_SIGNATURE', 400, message);
  }
}

export class PaymentDeclinedError extends DomainError {
  constructor(message: string) {
    super('PAYMENT_FAILED', 422, message);
  }
}

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, timestamp: number, payload: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
}

export function signatureHeader(
  secret: string,
  payload: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${signPayload(secret, timestamp, payload)}`;
}

export function verifySignatureHeader(
  header: string | undefined,
  secret: string,
  payload: string,
  now = Math.floor(Date.now() / 1000),
  tolerance = SIGNATURE_TOLERANCE_SECONDS,
): void {
  if (!header) throw new InvalidSignatureError('Missing signature header');
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [k, ...v] = part.trim().split('=');
      return [k ?? '', v.join('=')];
    }),
  ) as Record<string, string>;
  const timestamp = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(timestamp) || !provided) throw new InvalidSignatureError('Malformed signature header');
  if (Math.abs(now - timestamp) > tolerance)
    throw new InvalidSignatureError('Signature timestamp is outside the tolerance');
  const expected = Buffer.from(signPayload(secret, timestamp, payload));
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new InvalidSignatureError();
}

export function luhnValid(card: string): boolean {
  const digits = card.replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export type FakeCardOutcome = 'succeeded' | 'failed';

export function fakeCardOutcome(card: string): FakeCardOutcome {
  const digits = card.replace(/\D/g, '');
  if (digits === '4000000000000002') return 'failed';
  if (!luhnValid(digits)) throw new PaymentDeclinedError('Card number is invalid');
  return 'succeeded';
}
