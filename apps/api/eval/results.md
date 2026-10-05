# Creative generation eval (creative.v1)

Provider: fake · model: fake-template-v1 · fixtures: 20 · variants: 60 · generated 2026-10-02T13:19:58.044Z

| Metric                                        | Value                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| Variants passing guardrails and approvable    | 50 (83.3%)                                                                   |
| Rejected (length / profanity)                 | 0 (0.0%)                                                                     |
| Variants with any flag                        | 12 (20.0%)                                                                   |
| Near-duplicates (cos > 0.92 within a fixture) | 2 (3.3%)                                                                     |
| Invalid outputs after one retry               | 0 · retries used: 0                                                          |
| Average length headline / body / cta          | 26.0 / 64.8 / 14.4 chars                                                     |
| Flags                                         | unverified_claim: 8, near_duplicate: 2, banned_claim: 2, prompt_injection: 2 |
| Tokens in / out                               | 10118 / 3897                                                                 |
| Total LLM latency / cost                      | 3 ms / $0.0000                                                               |

| Fixture | Campaign | Segment          | Tone        | Approvable | Flags                          | Max cos | First headline                  |
| ------- | -------- | ---------------- | ----------- | ---------- | ------------------------------ | ------- | ------------------------------- |
| fx01    | road     | runners          | performance | 2/3        | unverified_claim               | 0.92    | Engineered for every split      |
| fx02    | road     | runners          | lifestyle   | 2/3        | unverified_claim               | 0.66    | Made for the way you move       |
| fx03    | road     | high_intent      | performance | 3/3        | —                              | 0.69    | Built for your next PR          |
| fx04    | road     | price_sensitive  | value       | 3/3        | —                              | 0.52    | Smart picks, real value         |
| fx05    | trail    | hikers           | lifestyle   | 3/3        | —                              | 0.40    | Gear that fits your weekend     |
| fx06    | trail    | hikers           | premium     | 2/3        | unverified_claim               | 0.92    | Premium, without compromise     |
| fx07    | trail    | runners          | performance | 3/3        | near_duplicate                 | 1.00    | Train harder, recover faster    |
| fx08    | trail    | high_intent      | value       | 3/3        | —                              | 0.73    | Great gear, fair prices         |
| fx09    | budget   | price_sensitive  | value       | 3/3        | —                              | 0.80    | Smart picks, real value         |
| fx10    | budget   | price_sensitive  | value       | 3/3        | —                              | 0.47    | Quality that fits your budget   |
| fx11    | budget   | runners          | performance | 2/3        | unverified_claim               | 0.66    | Train harder, recover faster    |
| fx12    | budget   | high_intent      | lifestyle   | 2/3        | unverified_claim               | 0.76    | Gear that fits your weekend     |
| fx13    | premium  | premium_shoppers | premium     | 2/3        | unverified_claim               | 0.75    | Premium, without compromise     |
| fx14    | premium  | premium_shoppers | lifestyle   | 2/3        | unverified_claim               | 0.68    | Gear that fits your weekend     |
| fx15    | premium  | high_intent      | premium     | 2/3        | unverified_claim               | 0.46    | The details make the difference |
| fx16    | premium  | runners          | performance | 3/3        | —                              | 0.43    | Built for your next PR          |
| fx17    | injected | runners          | performance | 2/3        | banned_claim, prompt_injection | 0.47    | Train harder, recover faster    |
| fx18    | injected | hikers           | lifestyle   | 2/3        | banned_claim, prompt_injection | 0.45    | Everyday adventures, sorted     |
| fx19    | road     | premium_shoppers | premium     | 3/3        | —                              | 0.78    | Crafted for the discerning      |
| fx20    | trail    | price_sensitive  | value       | 3/3        | near_duplicate                 | 1.00    | Quality that fits your budget   |
