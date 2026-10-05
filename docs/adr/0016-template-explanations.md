# 0016. Explanations built from templates over real features, not by an LLM

- Status: accepted
- Date: 2026-10-02

## Context

Every personalised block can answer "Why this?": in the storefront's demo mode and on the decision page in
the admin. The explanation is a product feature (shoppers and merchants should trust what they see) and an
engineering tool (it is how we debug a wrong recommendation).

An LLM writes friendlier prose, but it does not know why the system decided. Given the profile and the
decision, it would produce a plausible story, which can include reasons that played no part ("because you
love trail running" for a holdout user who got a random creative). It would also put a paid, slow call
next to every decision or every click on "Why this?", and its output could not be asserted in tests.

## Decision

The explanation is structured data captured **at decision time** from the values the algorithm actually
used, plus short sentences rendered by fixed templates. No LLM is involved.

- `DecisionService.explain()` in `apps/api/src/modules/campaigns/application/decision.service.ts` builds an
  `Explanation` (zod schema in `@cip/contracts`):
  - `segment`: the primary segment (ADR 0015) and `matchedRules`, the human-readable rules that matched with
    the shopper's actual values (from the rule engine's `reasons`, e.g. `intent = 0.81 ≥ 0.7`);
    `otherSegments` lists the rest;
  - `profileSignals` from `profileSignals()` in `packages/personalization/src/profile.ts`: "Viewed 4 running
    products in the last 24h", "Strongest interest: road shoes (affinity 8.2)", "Placed 2 orders, the last one
    12 days ago", "Typical price range $75–$125", "High purchase intent right now (0.81)", "Has bought with a
    discount code before". Each line is emitted only if its condition holds in the profile;
  - `creative`: chosen arm, policy (`thompson_sampling`, `warmup` or `holdout_uniform`), and for every arm
    impressions, CTR, the sampled θ and P(best);
  - `products`: score, candidate strategies and per-feature `contributions` from the linear ranking model;
  - `text`: 1–4 sentences from templates that branch on the same facts: segment or default audience,
    holdout ("You are in the 10% control group…"), warm-up, the Thompson draw, cold start.
- The record is stored with the decision (Redis for 24 h for the storefront, ClickHouse `decisions` for the
  admin). `GET /v1/storefront/decisions/:id/explanation` returns it only to the same tenant and the same
  profile that received the decision.
- The storefront's "Why this?" panel renders this structure; it does not compute anything itself.

## Alternatives considered

- **LLM-written explanation from the decision record** — nicer language, but it can still add reasons that
  are not in the record, costs latency and money per request, and cannot be tested by equality.
- **LLM rewrite of the template text, offline, per template** — would improve wording without inventing facts,
  but adds little over carefully written templates for a handful of sentence shapes.
- **No explanation, only an admin debug view** — less work, but loses the trust feature and the demo story.

## Consequences

- Positive: every sentence is traceable to a number the algorithm used; nothing is invented. A holdout user is
  told they are in the control group.
- Positive: deterministic and cheap: no network call, and signals and rule reasons are asserted by equality
  in unit tests.
- Positive: the same structure powers the storefront panel, the admin decision page and debugging.
- Negative: the wording is plain and English-only; templates must be extended by hand for every new signal
  or language.
- Negative: the explanation describes inputs (segment, signals, contributions), not a causal answer to "would
  I have seen something else if…". That is a limitation of the linear model and the bandit, stated honestly.
- Negative: the record makes each decision message bigger (arms and products), which costs ClickHouse storage.
- Revisit when: merchants need localised explanations, or an explanation must cover a non-linear model whose
  contributions cannot be read off directly (then SHAP-style attributions, still not an LLM).

## Verification

- `packages/personalization/test/unit/engine.test.ts`, "builds features and signals from the Redis hash":
  for a known hash, the first signal is exactly "Viewed 1 running product in the last 24h" and another starts
  with "Placed 2 orders, the last one 12 days ago"; "evaluates nested all/any and reports matched rules"
  checks the rule reasons.
- The response shape is the shared `explanationSchema` (OpenAPI contract, ADR 0019).
  `DecisionService.explanation()` returns nothing, so the endpoint answers 404, for a decision id of another
  tenant or another profile.
- The storefront "Why this?" panel (`apps/storefront/src/components`) only renders the returned structure,
  so what the shopper reads is exactly what was recorded with the decision.
