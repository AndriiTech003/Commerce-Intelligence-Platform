import { describe, expect, it } from 'vitest';
import { accessibleBrand, contrastRatio, DARK_SURFACE, MIN_TEXT_CONTRAST } from '../../src/lib/brand-color';

describe('accessible brand colors', () => {
  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ea580c')).toBeCloseTo(3.56, 1);
  });

  it('darkens a light brand color until white text passes AA and keeps dark ones unchanged', () => {
    const runhub = accessibleBrand('#ea580c');
    expect(contrastRatio(runhub.brand, '#ffffff')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(runhub.brand).not.toBe('#ea580c');
    expect(accessibleBrand('#7c2d12').brand).toBe('#7c2d12');
  });

  it('lightens the brand for text on the dark theme surface', () => {
    for (const color of ['#ea580c', '#7c2d12', '#2563eb', '#000000'])
      expect(contrastRatio(accessibleBrand(color).brandOnDark, DARK_SURFACE)).toBeGreaterThanOrEqual(
        MIN_TEXT_CONTRAST,
      );
  });

  it('passes through values it cannot parse', () => {
    expect(accessibleBrand('red')).toEqual({ brand: 'red', brandOnDark: 'red' });
  });
});
