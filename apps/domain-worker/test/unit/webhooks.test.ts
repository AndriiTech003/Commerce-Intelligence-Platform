import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signPayload, sourceHash, verifySignature } from '../../src';

describe('merchant webhook signatures', () => {
  it('signs t.body with HMAC-SHA256 like Stripe', () => {
    const body = '{"id":"evt_1"}';
    const header = signPayload('whsec_test', 1790000000, body);
    const expected = createHmac('sha256', 'whsec_test').update(`1790000000.${body}`).digest('hex');
    expect(header).toBe(`t=1790000000,v1=${expected}`);
  });

  it('rejects tampered bodies, wrong secrets and replays outside the tolerance window', () => {
    const body = '{"type":"order.paid"}';
    const now = 1790000000;
    const header = signPayload('s', now, body);
    expect(verifySignature('s', header, body, { now })).toBe(true);
    expect(verifySignature('s', header, `${body} `, { now })).toBe(false);
    expect(verifySignature('other', header, body, { now })).toBe(false);
    expect(verifySignature('s', header, body, { now: now + 301 })).toBe(false);
    expect(verifySignature('s', 'garbage', body, { now })).toBe(false);
  });

  it('embedding source hash changes only when the embedding text changes', () => {
    expect(sourceHash('a | b')).toBe(sourceHash('a | b'));
    expect(sourceHash('a | b')).not.toBe(sourceHash('a | c'));
  });
});
