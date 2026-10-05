import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  assertTransition,
  canTransition,
  isRefundable,
  isTerminal,
  manualTransitions,
  InvalidTransitionError,
} from '../../src';

describe('order state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('pending_payment', 'paid')).toBe(true);
    expect(canTransition('paid', 'fulfilled')).toBe(true);
    expect(canTransition('fulfilled', 'delivered')).toBe(true);
  });

  it('rejects skipping states and moving out of terminal states', () => {
    expect(canTransition('pending_payment', 'fulfilled')).toBe(false);
    expect(canTransition('cancelled', 'paid')).toBe(false);
    expect(canTransition('refunded', 'paid')).toBe(false);
    expect(() => assertTransition('delivered', 'paid')).toThrow(InvalidTransitionError);
  });

  it('marks terminal states', () => {
    expect(ORDER_STATUSES.filter(isTerminal)).toEqual(['cancelled', 'refunded']);
  });

  it('exposes only manual transitions to staff', () => {
    expect(manualTransitions('pending_payment')).toEqual(['cancelled']);
    expect(manualTransitions('paid')).toEqual(['fulfilled']);
    expect(manualTransitions('fulfilled')).toEqual(['delivered']);
  });

  it('allows refunds only after payment', () => {
    expect(isRefundable('pending_payment')).toBe(false);
    expect(isRefundable('paid')).toBe(true);
    expect(isRefundable('delivered')).toBe(true);
  });
});
