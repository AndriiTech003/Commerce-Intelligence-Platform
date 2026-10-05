# 0013. LLM outside the hot path: offline creative generation with human approval

- Status: accepted
- Date: 2026-10-02

## Context

Campaign blocks on the storefront show a headline, body and CTA. Writing several variants per segment and
tone by hand is slow, so an LLM should help. The tempting design is to generate copy per visitor at request
time. That puts a multi-second, paid, non-deterministic call on a page render whose decision budget is
p95 < 50 ms; it shows text no human has seen, under the merchant's brand, to real shoppers; and it makes
experiments meaningless, because every impression gets a different "variant".

Product descriptions are written by merchants and imported from CSV, so they are untrusted input to the
prompt. A model can also invent prices, discounts or "free shipping" that the store does not offer.

## Decision

The LLM **proposes** variants offline; a human **approves** them; the bandit (ADR 0014) **decides** which
approved variant a shopper sees. The decision API never calls an LLM.

- **Generation** (`apps/api/src/modules/campaigns/application/creative.service.ts`): a marketer calls
  `POST /v1/admin/campaigns/:id/creatives/generate` for some segments and tones, synchronously or as a job. The prompt
  gets only aggregates, no PII: store name and brand voice, the top-10 campaign products by popularity with
  real prices, segment rules in words plus aggregated behaviour, and the active discounts.
- **Prompt as a versioned file**: `apps/api/src/modules/campaigns/prompts/creative.v1.md`. Product
  descriptions go inside `<untrusted_product_data>`, the system prompt says to treat them as data only, and
  `promptVariables` strips any `untrusted_product_data` tags from the descriptions so they cannot close the
  block.
- **Structured output**: `LlmClient` (`apps/api/src/shared/llm/llm.ts`) has three adapters. The Anthropic
  adapter passes a JSON schema as `output_config.format`, the OpenAI-compatible adapter uses
  `response_format: json_schema` with `strict: true` (also works with local servers), and `FakeLlmClient`
  produces deterministic templates for tests, CI and offline demos. Output is validated with zod; on failure
  there is **one** retry with the validation error appended, then the job fails.
- **Deterministic guardrails** after generation (`domain/guardrails.ts`): length limits 60/160/24 and
  profanity reject the variant; prices and percentages are checked against real product prices and active
  discounts (`unverified_claim`), plus `banned_claim`, `near_duplicate` (cosine > 0.92 to existing
  creatives), `language_mismatch` and `prompt_injection`. `unverified_claim` and `prompt_injection` block
  approval until a human edits the text.
- **Cost control**: a cache by `inputHash` (SHA-256 of prompt version, model, system, prompt and schema,
  30-day TTL) so a repeated generation is free; a per-tenant daily quota (`LLM_DAILY_LIMIT`, default 50,
  overridable in tenant settings). Model, prompt version, tokens, latency, cost and attempts are stored with
  every creative.
- **Review**: creatives start as `draft`. Only `marketing:approve` can approve or reject; transitions are
  `draft → approved | rejected`, `approved → active ⇄ paused`. The decision service serves only `active`
  creatives (`isServable` in `domain/campaign.ts`).

## Alternatives considered

- **Generate on the fly per visitor** — maximum personalisation, but seconds of latency and a cost per page
  view, no review, no reproducibility, and no stable arms to learn from.
- **Generate offline and auto-publish if guardrails pass** — faster for the marketer, but guardrails are
  rules that catch known failure shapes, not judgement. Brand risk stays with a human.
- **Pre-generate per individual profile** — personal copy without request-time latency, but the number of
  variants explodes and none of them gets enough traffic to measure.

## Consequences

- Positive: the decision path stays a Redis read plus a Beta sample; LLM outages or rate limits never break
  the storefront.
- Positive: every shown text was approved by a person, and every claim about price or discount was checked
  against the database.
- Positive: arms are stable, so the bandit and the experiment screen measure something real.
- Negative: personalisation of copy is per segment and tone, not per person.
- Negative: a human in the loop slows the start of a campaign. The seed approves demo creatives
  automatically; production would not.
- Negative: guardrails are heuristics. A creative injection such as a paraphrased instruction can pass the
  pattern checks; human review is the real control.
- Negative: `FakeLlmClient` deliberately sometimes adds "Now 25% off" and repeats injected instructions, so
  guardrails are exercised in tests, but it says nothing about a real model's quality.
- Revisit when: real-time context (weather, stock levels) must change the copy, or reviewers become the
  bottleneck; a "pre-approved template with slots" model would be the next step.

## Verification

- Human-approval property test: for random sequences of generate, edit, approve, reject, pause and resume,
  the decision API never serves a `draft` or `rejected` creative.
- Injection test: a product description containing "ignore previous instructions…" goes through generation;
  the resulting variant is flagged `prompt_injection` and cannot be approved.
- `pnpm eval:creatives`: fixtures (campaign × segment × tone) → generation → share passing guardrails, mean
  lengths, duplicate share. Results go to the README.
- LLM metrics per provider: requests by outcome (`ok`, `ok_after_retry`, `invalid_output`, `cache_hit`,
  `limited`), tokens, latency and cost.
