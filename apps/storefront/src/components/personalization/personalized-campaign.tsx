'use client';

import { useCallback, useRef, type MouseEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CampaignBlock, type CampaignProductView } from '@cip/ui';
import type { Decision, Placement } from '@/lib/types';
import { adClickProps, adImpressionProps } from '@/lib/personalization';
import { useTracker } from '../tracker-provider';
import { useDecision } from './use-personalization';
import { useImpression } from './use-impression';
import { useDemoMode } from './demo-mode';
import { WhyThisTrigger } from './why-this-dialog';
import { DecisionExplanationView } from './decision-explanation';

const productHref = (product: CampaignProductView) => `/p/${encodeURIComponent(product.slug)}`;

function internalHref(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute('href');
  if (!href || !href.startsWith('/') || href.startsWith('//')) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;
  return href;
}

function CampaignView({
  decision,
  heading,
  className,
}: {
  decision: Decision;
  heading?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const tracker = useTracker();
  const demo = useDemoMode();

  useImpression(ref, decision.decisionId, () => tracker.track('ad_impression', adImpressionProps(decision)));

  const clicked = useCallback(
    (target: { product: CampaignProductView; position: number } | null) => {
      const product = target
        ? (decision.products.find((candidate) => candidate.id === target.product.id) ?? null)
        : null;
      tracker.track(
        'ad_clicked',
        adClickProps(decision, product && target ? { product, position: target.position } : null),
      );
      tracker.flush();
    },
    [decision, tracker],
  );

  const navigate = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest('a');
    if (!anchor || !ref.current?.contains(anchor)) return;
    const href = internalHref(anchor);
    if (!href) return;
    event.preventDefault();
    router.push(href);
  };

  return (
    <div
      ref={ref}
      onClick={navigate}
      className={className}
      data-testid="personalized-campaign"
      data-placement={decision.placement}
      data-decision-id={decision.decisionId}
      data-campaign-id={decision.campaignId}
      data-creative-id={decision.creativeId}
      data-segment-key={decision.segmentKey}
    >
      {heading}
      <CampaignBlock
        placement={decision.placement}
        creative={decision.creative}
        products={decision.products}
        productHref={productHref}
        onCtaClick={() => clicked(null)}
        onProductClick={(product, position) => clicked({ product, position })}
        badge={
          demo ? (
            <WhyThisTrigger
              title="Why am I seeing this?"
              subtitle={
                <>
                  Decision <code className="text-[11px]">{decision.decisionId}</code>
                </>
              }
              buttonTestId="why-this-button"
              panelTestId="why-this-panel"
              tone={decision.placement === 'home_hero' ? 'onBrand' : 'light'}
            >
              <DecisionExplanationView decisionId={decision.decisionId} />
            </WhyThisTrigger>
          ) : undefined
        }
      />
    </div>
  );
}

export function PersonalizedCampaign({
  placement,
  productId,
  limit,
  refreshKey,
  fallback = null,
  heading,
  className,
}: {
  placement: Placement;
  productId?: string;
  limit?: number;
  refreshKey?: string;
  fallback?: ReactNode;
  heading?: ReactNode;
  className?: string;
}) {
  const { data } = useDecision({ placement, productId, limit }, { refreshKey });
  if (!data) return <>{fallback}</>;
  return <CampaignView key={data.decisionId} decision={data} heading={heading} className={className} />;
}
