'use client';

import { betaMean } from '@cip/personalization';
import { useMemo } from 'react';
import { densityCurves, densityRange, niceTicks, pct } from '@/lib/experiment';

export interface DensityInput {
  id: string;
  label: string;
  color: string;
  alpha: number;
  beta: number;
  high: number;
}

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { left: 12, right: 12, top: 10, bottom: 26 };

export function BetaDensityChart({ arms }: { arms: DensityInput[] }) {
  const range = useMemo(() => densityRange(arms), [arms]);
  const curves = useMemo(() => densityCurves(arms, range), [arms, range]);
  const peak = Math.max(1e-9, ...curves.map((c) => c.peak));
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const sx = (x: number) => PAD.left + ((x - range[0]) / (range[1] - range[0])) * innerW;
  const sy = (y: number) => PAD.top + innerH - (Math.min(y, peak) / peak) * innerH;
  const ticks = niceTicks(range[0], range[1]);
  if (arms.length === 0) return null;
  return (
    <figure className="space-y-2" data-testid="beta-density">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full text-slate-500 dark:text-slate-400"
        role="img"
        aria-label={`Posterior Beta densities of ${arms.length} arms between ${pct(range[0])} and ${pct(range[1])}`}
      >
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={PAD.top + innerH}
          y2={PAD.top + innerH}
          stroke="currentColor"
          strokeWidth={1}
        />
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={sx(tick)}
              x2={sx(tick)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="currentColor"
              strokeOpacity={0.15}
              strokeDasharray="2 4"
            />
            <text x={sx(tick)} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="currentColor">
              {pct(tick, Number.isInteger(Math.round(tick * 1e6) / 1e4) ? 0 : 1)}
            </text>
          </g>
        ))}
        {curves.map((curve, index) => {
          const arm = arms[index]!;
          const line = curve.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
            .join(' ');
          const area = `${line} L${sx(range[1]).toFixed(1)},${sy(0).toFixed(1)} L${sx(range[0]).toFixed(1)},${sy(0).toFixed(1)} Z`;
          const mean = betaMean(arm.alpha, arm.beta);
          return (
            <g key={arm.id}>
              <title>{`${arm.label}: Beta(${arm.alpha}, ${arm.beta}), mean ${pct(mean, 2)}`}</title>
              <path d={area} fill={arm.color} fillOpacity={0.12} />
              <path d={line} fill="none" stroke={arm.color} strokeWidth={2} strokeLinejoin="round" />
              {mean >= range[0] && mean <= range[1] ? (
                <line
                  x1={sx(mean)}
                  x2={sx(mean)}
                  y1={PAD.top + innerH}
                  y2={PAD.top + innerH - 6}
                  stroke={arm.color}
                  strokeWidth={2}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        {arms.map((arm) => (
          <span key={arm.id} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: arm.color }}
              aria-hidden="true"
            />
            {arm.label}
            <span className="font-mono text-slate-500 dark:text-slate-400">
              Beta({arm.alpha}, {arm.beta})
            </span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
