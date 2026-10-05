import { describe, expect, it } from 'vitest';
import { formatPriceFilter, parsePriceFilter, priceFilterFromInputs } from '@/lib/price-filter';
import { buildFilterHref, catalogQueryFromParams, toSearchString } from '@/lib/catalog-query';

describe('parsePriceFilter', () => {
  it('converts major units to cents', () => {
    expect(parsePriceFilter('50-150')).toEqual({ minCents: 5000, maxCents: 15000 });
    expect(parsePriceFilter('19.99-20.5')).toEqual({ minCents: 1999, maxCents: 2050 });
  });

  it('supports open ranges', () => {
    expect(parsePriceFilter('50-')).toEqual({ minCents: 5000, maxCents: null });
    expect(parsePriceFilter('-80')).toEqual({ minCents: null, maxCents: 8000 });
  });

  it('swaps inverted ranges and ignores garbage', () => {
    expect(parsePriceFilter('150-50')).toEqual({ minCents: 5000, maxCents: 15000 });
    expect(parsePriceFilter('abc')).toEqual({ minCents: null, maxCents: null });
    expect(parsePriceFilter('1-2-3')).toEqual({ minCents: null, maxCents: null });
    expect(parsePriceFilter('x-10')).toEqual({ minCents: null, maxCents: 1000 });
    expect(parsePriceFilter(undefined)).toEqual({ minCents: null, maxCents: null });
  });

  it('round-trips through the formatter', () => {
    expect(formatPriceFilter({ minCents: 5000, maxCents: 15000 })).toBe('50-150');
    expect(formatPriceFilter({ minCents: 1999, maxCents: null })).toBe('19.99-');
    expect(formatPriceFilter({ minCents: null, maxCents: null })).toBeNull();
    expect(priceFilterFromInputs('50', '150')).toBe('50-150');
    expect(priceFilterFromInputs('', '')).toBeNull();
  });
});

describe('catalog query', () => {
  it('maps URL params to API query params', () => {
    expect(
      catalogQueryFromParams({ price: '50-150', brand: 'Acme', sort: 'price_asc' }, { category: 'shoes' }),
    ).toEqual({
      category: 'shoes',
      priceMin: 5000,
      priceMax: 15000,
      brand: 'Acme',
      sort: 'price_asc',
    });
    expect(catalogQueryFromParams({ sort: 'bogus' })).toEqual({});
  });

  it('serialises queries and filter links', () => {
    expect(toSearchString({ category: 'shoes', limit: 24, brand: undefined })).toBe(
      '?category=shoes&limit=24',
    );
    expect(
      buildFilterHref('/c/shoes', { brand: 'Acme', sort: 'newest' }, { brand: null, price: '10-20' }),
    ).toBe('/c/shoes?sort=newest&price=10-20');
    expect(buildFilterHref('/c/shoes', {}, { brand: null })).toBe('/c/shoes');
  });
});
