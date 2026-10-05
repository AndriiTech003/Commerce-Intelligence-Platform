'use client';

import { useId, useMemo } from 'react';
import type { RecommendationType } from '@/lib/types';
import { recommendationClickProps } from '@/lib/personalization';
import { GRID, ProductCardSkeleton } from '../product-grid';
import { ProductCard } from '../product-card';
import { useTracker } from '../tracker-provider';
import { useRecommendations } from './use-personalization';
import { useDemoMode } from './demo-mode';
import { WhyThisTrigger } from './why-this-dialog';
import { ContributionList } from './contribution-bars';

export interface RecommendationsSectionProps {
  type: RecommendationType;
  title: string;
  testId: string;
  productId?: string;
  limit?: number;
  show?: number;
  exclude?: readonly string[];
  refreshKey?: string;
  explainable?: boolean;
  description?: string;
  gridClassName?: string;
}

export function RecommendationsSection({
  type,
  title,
  testId,
  productId,
  limit = 8,
  show,
  exclude,
  refreshKey,
  explainable = false,
  description,
  gridClassName = GRID,
}: RecommendationsSectionProps) {
  const headingId = useId();
  const tracker = useTracker();
  const demo = useDemoMode();
  const { data, isPending, isError } = useRecommendations(
    { type, productId, limit },
    { refreshKey, keepPrevious: refreshKey !== undefined },
  );
  const items = useMemo(() => {
    const hidden = new Set(exclude ?? []);
    const visible = (data?.items ?? []).filter((item) => !hidden.has(item.id) && item.id !== productId);
    return visible.slice(0, show ?? limit);
  }, [data, exclude, productId, show, limit]);

  if (isPending) {
    return (
      <section aria-labelledby={headingId} aria-busy="true" data-testid={`${testId}-loading`}>
        <div className="mb-4">
          <h2 id={headingId} className="text-xl font-semibold">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>
          ) : null}
        </div>
        <div className={gridClassName} role="status" aria-label={`Loading ${title}`}>
          {Array.from({ length: show ?? limit }, (_, index) => (
            <ProductCardSkeleton key={index} />
          ))}
        </div>
      </section>
    );
  }

  if (isError || !data || items.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      data-decision-id={data.decisionId}
      data-cold-start={data.coldStart ? 'true' : 'false'}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-xl font-semibold">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>
          ) : null}
        </div>
        {demo && explainable ? (
          <WhyThisTrigger
            title={`Why these recommendations? · ${title}`}
            subtitle={
              data.coldStart
                ? 'Cold start: we know little about you yet, so popular items are mixed in.'
                : 'Ranked by a transparent linear model over your profile.'
            }
            buttonTestId="reco-why-this-button"
            panelTestId="reco-why-this-panel"
          >
            <ContributionList products={items} testId="reco-why-this-contributions" />
          </WhyThisTrigger>
        ) : null}
      </div>
      <div className={gridClassName}>
        {items.map((item, position) => (
          <ProductCard
            key={item.id}
            product={item}
            testId="reco-item"
            attributes={{ 'data-position': position, 'data-strategy': item.strategies[0] ?? '' }}
            onClick={() =>
              tracker.track('recommendation_clicked', recommendationClickProps(data, item, position))
            }
          />
        ))}
      </div>
    </section>
  );
}
