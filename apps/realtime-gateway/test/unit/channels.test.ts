import { describe, expect, it } from 'vitest';
import { parseTicket, tenantFromChannel } from '../../src';

describe('gateway helpers', () => {
  const tenant = '0190a000-0000-7000-8000-000000000001';

  it('extracts the tenant from prefixed channels', () => {
    expect(tenantFromChannel(`p:rt:${tenant}:tick`, 'p:')).toEqual({ tenantId: tenant, kind: 'tick' });
    expect(tenantFromChannel(`rt:${tenant}:events`, '')).toEqual({ tenantId: tenant, kind: 'events' });
    expect(tenantFromChannel(`other:rt:${tenant}:tick`, 'p:')).toBeNull();
    expect(tenantFromChannel('rt:nope:tick', '')).toBeNull();
  });

  it('parses tickets defensively', () => {
    expect(parseTicket(JSON.stringify({ tenantId: tenant, userId: 'u' }))).toEqual({
      tenantId: tenant,
      userId: 'u',
    });
    expect(parseTicket('garbage')).toBeNull();
    expect(parseTicket(null)).toBeNull();
  });
});
