import { standardNormal, type Rng } from './random';

export function sampleGamma(shape: number, rng: Rng): number {
  if (!(shape > 0)) throw new RangeError('gamma shape must be positive');
  if (shape < 1) {
    const u = rng();
    return sampleGamma(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = standardNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    const x2 = x * x;
    if (u < 1 - 0.0331 * x2 * x2) return d * v;
    if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(alpha: number, beta: number, rng: Rng): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  const total = x + y;
  return total > 0 ? x / total : 0.5;
}

export function betaMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

export function betaVariance(alpha: number, beta: number): number {
  const total = alpha + beta;
  return (alpha * beta) / (total * total * (total + 1));
}

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const x = z - 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i]! / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function logBetaFunction(alpha: number, beta: number): number {
  return logGamma(alpha) + logGamma(beta) - logGamma(alpha + beta);
}

export function betaPdf(x: number, alpha: number, beta: number): number {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp((alpha - 1) * Math.log(x) + (beta - 1) * Math.log(1 - x) - logBetaFunction(alpha, beta));
}

export function betaDensityCurve(
  alpha: number,
  beta: number,
  points = 120,
  range: [number, number] = [0, 1],
): Array<{ x: number; y: number }> {
  const [from, to] = range;
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= points; i++) {
    const x = from + ((to - from) * i) / points;
    out.push({ x, y: betaPdf(Math.min(Math.max(x, 1e-9), 1 - 1e-9), alpha, beta) });
  }
  return out;
}
