import { describe, expect, it } from 'vitest';
import { isValidStoreSlug, resolveStoreSlug, storeSlugFromHost } from '@/lib/store-slug';

describe('storeSlugFromHost', () => {
  it('reads the subdomain of localhost hosts with a port', () => {
    expect(storeSlugFromHost('runhub.localhost:4130')).toBe('runhub');
    expect(storeSlugFromHost('HomeBrew.localhost')).toBe('homebrew');
  });

  it('reads the first label of production hosts', () => {
    expect(storeSlugFromHost('runhub.demo.example.com')).toBe('runhub');
  });

  it('ignores hosts without a store subdomain', () => {
    expect(storeSlugFromHost('localhost:4130')).toBeNull();
    expect(storeSlugFromHost('127.0.0.1:4130')).toBeNull();
    expect(storeSlugFromHost('example.com')).toBeNull();
    expect(storeSlugFromHost('www.example.com')).toBeNull();
    expect(storeSlugFromHost('[::1]:4130')).toBeNull();
    expect(storeSlugFromHost(null)).toBeNull();
  });
});

describe('resolveStoreSlug', () => {
  it('prefers host, then query, then cookie, then the default', () => {
    expect(
      resolveStoreSlug({ host: 'runhub.localhost', query: 'homebrew', cookie: 'x', fallback: 'd' }),
    ).toEqual({
      slug: 'runhub',
      source: 'host',
    });
    expect(
      resolveStoreSlug({ host: 'localhost', query: 'homebrew', cookie: 'runhub', fallback: 'd' }),
    ).toEqual({
      slug: 'homebrew',
      source: 'query',
    });
    expect(resolveStoreSlug({ host: 'localhost', cookie: 'runhub', fallback: 'd' })).toEqual({
      slug: 'runhub',
      source: 'cookie',
    });
    expect(resolveStoreSlug({ host: 'localhost', fallback: 'runhub' })).toEqual({
      slug: 'runhub',
      source: 'default',
    });
  });

  it('rejects malformed slugs from query and cookie', () => {
    expect(resolveStoreSlug({ query: '../etc', cookie: 'bad slug', fallback: 'runhub' }).slug).toBe('runhub');
    expect(isValidStoreSlug('-bad')).toBe(false);
    expect(isValidStoreSlug('good-1')).toBe(true);
  });
});
