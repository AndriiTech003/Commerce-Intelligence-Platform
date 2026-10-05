# 0017. Personal blocks are loaded separately from the cached page

- Status: accepted
- Date: 2026-10-02

## Context

The storefront home page and product pages (`apps/storefront`, Next.js App Router) are mostly the same for
everyone: catalog data, prices, images. They are rendered with ISR (`revalidate = 60`, plus `revalidateTag`
through `apps/storefront/src/app/api/revalidate/route.ts` when the catalog changes), which keeps LCP low and
takes load off the API.

Some blocks on those pages are personal: the `home_hero` campaign block, "For you", "Similar", "Bought
together", `pdp_sidebar`. If a personal block is rendered into the cached HTML, the first visitor's
recommendations (and their "Why this?" decision id) are served to everyone else for 60 seconds. That is a
privacy leak and makes the bandit's impression counts wrong. Making the whole page dynamic fixes the leak but
throws away the cache for most of the page, which is not personal.

A second problem: an impression is the bandit's denominator (ADR 0014). Counting an impression when the block
is rendered, even below the fold or in a background tab, inflates `β` and makes CTR look worse than it is.

## Decision

Split the page into a **cached shell** and **personal islands**:

- Pages stay ISR. Server-side catalog fetches use `next: { revalidate, tags }`
  (`apps/storefront/src/lib/server-api.ts`), and nothing that depends on the visitor's cookie or
  `anonymous_id` is read while rendering the cached part.
- Personal blocks are client components (in `apps/storefront/src/components`) that, after hydration, call
  `/api/v1/storefront/decisions?placement=…` and `/api/v1/storefront/recommendations?type=…` with
  `cache: 'no-store'`. The request goes through the storefront's own proxy route
  (`apps/storefront/src/app/api/v1/[...path]/route.ts`, `force-dynamic`, `cache: 'no-store'` upstream), which
  forwards `x-anonymous-id` and the auth cookie. The API answers with `Cache-Control: no-store`
  (`DecisionsController`, `RecommendationsController`), so no CDN or browser cache can share the answer.
- While the block loads, a fixed-size skeleton keeps the layout stable (CLS budget < 0.1). If the call fails
  or returns 204 (no live campaign), the block renders nothing; the page still works.
- **Impression only when seen**: the block observes itself with `IntersectionObserver` and sends
  `ad_impression` (with the `decision_id`) only after it has been at least 50 % visible for at least 1 second
  continuously. The timer resets when it leaves the viewport, and one decision id is reported once (the
  bandit also dedupes by `decision_id`).
- "Why this?" (demo mode) fetches `/decisions/:id/explanation` on demand, also `no-store`.

## Alternatives considered

- **Full SSR without cache** (`dynamic = 'force-dynamic'` for every page) — simplest and personal blocks are
  in the first HTML, but every page view hits the API for catalog data, LCP depends on the decision latency,
  and the CDN cannot help.
- **Edge personalisation** (middleware rewrites to per-segment cached variants) — fast and cacheable, but
  personal down to the segment only, not the profile; the bandit choice and product ranking would have to run
  at the edge or be pre-computed per segment, and the cache key space multiplies.
- **RSC with `Suspense` and a `no-store` fetch** inside the page — streams the personal block in the same
  response, but any dynamic data access turns the whole route dynamic in Next.js 15 without partial
  prerendering, which is still experimental. A client fetch keeps ISR intact today.

## Consequences

- Positive: the cached HTML contains nothing personal, so cache entries cannot leak between visitors.
- Positive: the storefront stays fast; the decision latency affects only when the block appears, not LCP of
  the page.
- Positive: impressions mean "a person could see it", which keeps the bandit's CTR honest.
- Negative: personal blocks appear after hydration plus one API round trip, and crawlers do not see them
  (acceptable: they are personal).
- Negative: one extra request per personal block per page view. Blocks on the same page could be batched
  into one call later.
- Negative: the visibility rule undercounts users who scroll past in less than 1 second; that is the intended
  definition, but it differs from "rendered" impressions in ad tools.
- Revisit when: partial prerendering becomes stable (personal holes in a static shell, streamed in the same
  response), or the extra round trip shows up in Web Vitals.

## Verification

The storefront blocks are being implemented together with these checks:

- Two visitors with different profiles load the same ISR page: the HTML is byte-identical, while the
  decisions and recommendations they receive differ (described in `docs/07-frontend.md`, Personalised blocks).
- Response headers of `/v1/storefront/decisions` and `/v1/storefront/recommendations` are `no-store`.
- Impression rule: a unit test of the visibility hook with a mocked `IntersectionObserver` and fake timers —
  49 % visibility or 0.9 s visible sends nothing; ≥ 50 % for 1 s sends exactly one `ad_impression`.
