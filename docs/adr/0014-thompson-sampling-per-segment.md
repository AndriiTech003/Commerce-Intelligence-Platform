# 0014. Thompson sampling per segment for creative selection

- Status: accepted
- Date: 2026-10-02

## Context

A campaign has several approved creatives (arms) per placement, usually one per tone. We want to show the
variant that works best for each audience. A classic A/B test splits traffic evenly until significance and
then picks a winner: correct, but every impression spent on a clearly worse variant during the test is a lost
click, and with four tones × several segments the test runs for a long time. Preferences also drift (the
simulator's `shift` mode changes them on purpose), so a one-off winner goes stale.

The method must be cheap enough to run inside the decision API (p95 < 50 ms), deterministic in tests, and
explainable on the experiment screen and in "Why this?".

## Decision

**Beta-Bernoulli Thompson sampling**, one independent bandit per `(campaign, primary segment)` (segment
choice in ADR 0015), implemented in `packages/personalization/src/bandit.ts`.

- **State** in a Redis hash per campaign and segment: per creative `α = 1 + s`, `β = 1 + n − s`, `n`
  impressions, `s` successes (clicks or attributed conversions, by campaign goal). A new creative starts at
  Beta(1, 1).
- **Choice** (`thompsonChoose`): sample `θ ~ Beta(α, β)` for every arm and take the argmax. Our own sampler:
  a seeded PRNG (`random.ts`, xoshiro128\*\* seeded by splitmix32) and Marsaglia–Tsang Gamma sampling,
  `Beta = X / (X + Y)` (`beta.ts`). No dependency; the API seeds from `crypto.getRandomValues`, tests use a
  fixed seed and get identical draws.
- **Warm-up**: while any arm has fewer than `BANDIT_WARMUP` = 50 impressions, a uniformly random cold arm is
  served (`policy: 'warmup'`).
- **Updates** in Lua (`BANDIT_IMPRESSION_LUA`, `BANDIT_SUCCESS_LUA`): an impression adds 1 to `β` and `n`; a
  success moves 1 from `β` to `α`. Impressions are deduplicated by `decision_id` (`SET NX`), clicks and
  conversions by their own keys. A click that arrives before its impression counts the impression first, so
  `β` never goes below 1.
- **Non-stationarity**: optional discount `γ` (`BANDIT_DISCOUNT`, default 1 = off). With `γ < 1` every update
  shrinks all `α, β` towards the prior: `x ← 1 + γ(x − 1)`.
- **Holdout**: 10 % of profiles (`HOLDOUT_PERCENT`, sticky by hashing `profile:campaign`) get a uniformly
  random creative and store bestsellers (`policy: 'holdout_uniform'`). Their feedback is not fed to the
  bandit; ClickHouse compares holdout CTR with the personalised group.
- **Persistence and stats**: arms are snapshotted to `bandit_snapshots` every 5 minutes
  (`BANDIT_SNAPSHOT_INTERVAL_MS`) and restored if the Redis hash is empty. The experiment screen shows CTR with
  a 95 % Wilson interval and P(best) from 10 000 joint Monte Carlo samples (`stats.ts`).

## Alternatives considered

- **Fixed-split A/B test** — clean frequentist inference and an unbiased effect estimate, but maximum
  regret during the test and a manual "stop and pick" step per segment.
- **ε-greedy** — trivial, but explores at a constant rate forever, including on arms already known to be bad,
  and ε is one more knob.
- **UCB1** — deterministic and well understood, but deterministic choices make all concurrent requests pick
  the same arm between updates, and it handles delayed feedback worse than randomised sampling.
- **Contextual bandit (LinUCB, contextual Thompson)** — would use profile features inside a segment, but needs
  a feature vector per request, matrix state per arm, and far more traffic to learn. The segment is our
  context for now; this is listed as the next step in Known limitations.

## Consequences

- Positive: traffic moves to better variants while learning, and a new creative gets traffic naturally
  through its wide prior.
- Positive: the whole state is two numbers per arm; a decision is one `HGETALL` and a few Gamma samples.
- Positive: the explanation can show the sampled value, CTR and P(best) for every arm.
- Negative: bandit data is not an unbiased A/B estimate; allocation depends on past results. The holdout is
  there to measure the uplift of personalisation honestly.
- Negative: delayed feedback. A click arrives seconds after the impression, a conversion up to 24 h later
  (last-click attribution), so the `β` of conversion-goal arms is temporarily inflated.
- Negative: with `γ < 1` every update rewrites all arms of the hash, and the effective memory is ~1/(1 − γ)
  updates. It is off by default.
- Negative: up to 5 minutes of learning is lost if Redis is lost between snapshots.
- Revisit when: segments get too coarse (the experiment screen shows very different CTRs inside one
  segment), or a campaign has many arms and needs a contextual model.

## Verification

- `packages/personalization/test/unit/math.test.ts`:
  - "Beta(α, β) matches analytic mean and variance on 100k samples" for (1,1), (2,5), (30,70), (0.5,0.5),
    (181,3420), plus the same for Gamma, and reproducibility with the same seed;
  - "serves arms uniformly during warm-up";
  - "Thompson sampling converges on the best arm in a simulated run" — 4 arms with true CTR 3 %, 5.4 %,
    2.7 %, 3.3 % over 20 000 rounds: the best arm gets > 10 000 impressions and has the highest P(best), and
    regret is less than half of uniform A/B regret;
  - Wilson interval reference values and P(best) properties.
- **M6 simulation**: Measured on simulated traffic: see README Performance/Personalization section.
  _(Numbers to be filled in by the lead after the M6 run: regret vs uniform A/B, time to find the right tone
  per persona.)_
