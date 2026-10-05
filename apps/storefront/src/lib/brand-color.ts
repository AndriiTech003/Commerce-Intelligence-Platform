const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

type Rgb = [number, number, number];

function parse(hex: string): Rgb | null {
  const match = HEX.exec(hex);
  if (!match) return null;
  const value = match[1]!.length === 3 ? [...match[1]!].map((c) => c + c).join('') : match[1]!;
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 1;
  const [hi, lo] = [luminance(x), luminance(y)].sort((m, n) => n - m) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function mix(rgb: Rgb, target: Rgb, amount: number): Rgb {
  return rgb.map((c, i) => c + (target[i]! - c) * amount) as Rgb;
}

function adjustUntil(hex: string, target: Rgb, against: string, minRatio: number): string {
  const rgb = parse(hex);
  if (!rgb) return hex;
  for (let step = 0; step <= 20; step += 1) {
    const candidate = toHex(mix(rgb, target, step * 0.05));
    if (contrastRatio(candidate, against) >= minRatio) return candidate;
  }
  return toHex(target);
}

export const MIN_TEXT_CONTRAST = 4.6;
export const DARK_SURFACE = '#0f172a';

export function accessibleBrand(hex: string): { brand: string; brandOnDark: string } {
  return {
    brand: adjustUntil(hex, [0, 0, 0], '#ffffff', MIN_TEXT_CONTRAST),
    brandOnDark: adjustUntil(hex, [255, 255, 255], DARK_SURFACE, MIN_TEXT_CONTRAST),
  };
}
