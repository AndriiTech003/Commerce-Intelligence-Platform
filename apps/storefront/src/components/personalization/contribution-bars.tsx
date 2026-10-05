import type { Contributions } from '@/lib/types';
import { CONTRIBUTION_FEATURES, contributionShares } from '@/lib/personalization';

const COLORS: Record<keyof Contributions, string> = {
  similarity: 'bg-sky-500',
  affinity: 'bg-violet-500',
  popularity: 'bg-amber-500',
  priceFit: 'bg-emerald-500',
  freshness: 'bg-rose-500',
};

export function ContributionLegend() {
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300"
      aria-hidden="true"
    >
      {CONTRIBUTION_FEATURES.map((feature) => (
        <li key={feature.key} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-sm ${COLORS[feature.key]}`} />
          {feature.label}
          <span className="text-slate-500 dark:text-slate-400">×{feature.weight}</span>
        </li>
      ))}
    </ul>
  );
}

export function ContributionBar({ contributions }: { contributions: Contributions }) {
  const shares = contributionShares(contributions);
  const summary = shares.map((share) => `${share.label} ${share.value.toFixed(3)}`).join(', ');
  return (
    <div
      role="img"
      aria-label={`Score contributions: ${summary}`}
      data-testid="contribution-bar"
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
    >
      {shares.map((share) =>
        share.percent > 0 ? (
          <span
            key={share.key}
            data-feature={share.key}
            title={`${share.label}: ${share.value.toFixed(3)}`}
            className={`h-full ${COLORS[share.key]}`}
            style={{ width: `${share.percent}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

export interface ScoredProduct {
  id: string;
  title?: string;
  score: number;
  strategies: string[];
  contributions: Contributions;
}

export function ContributionList({ products, testId }: { products: ScoredProduct[]; testId: string }) {
  if (!products.length)
    return <p className="text-slate-500 dark:text-slate-400">No products were scored for this decision.</p>;
  return (
    <div className="space-y-3">
      <ContributionLegend />
      <ol className="space-y-3" data-testid={testId}>
        {products.map((product, index) => (
          <li key={product.id} className="space-y-1.5" data-testid="contribution-item">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-medium">
                <span className="mr-1.5 text-slate-500 dark:text-slate-400 tabular-nums">{index + 1}.</span>
                {product.title ?? product.id}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                score{' '}
                <strong className="text-slate-900 dark:text-slate-100">{product.score.toFixed(3)}</strong>
              </span>
            </div>
            <ContributionBar contributions={product.contributions} />
            {product.strategies.length ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                via{' '}
                {product.strategies.map((strategy) => (
                  <code
                    key={strategy}
                    className="mr-1 rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    {strategy}
                  </code>
                ))}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
