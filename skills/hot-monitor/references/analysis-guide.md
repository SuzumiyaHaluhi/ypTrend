# Analysis Guide

## Objective

Convert raw cross-source records into decision-ready hotspot judgments.

## Rubric

Score each candidate on four dimensions:

1. Relevance (`0-5`)
Match to target query or monitoring theme.
2. Credibility (`0-5`)
Quality of source and evidence corroboration.
3. Timeliness (`0-5`)
Recency and velocity of discussion.
4. Impact (`0-5`)
Potential effect on users, products, policy, or market narrative.

Total score:
`overall = relevance + credibility + timeliness + impact` (`0-20`)

## Classification

1. `P0 / Immediate Follow-up`: `16-20`
2. `P1 / Watch Closely`: `11-15`
3. `P2 / Background Signal`: `6-10`
4. `Drop`: `0-5`

## Credibility Heuristics

1. Prefer primary announcements over reposts.
2. Increase confidence when multiple unrelated sources agree.
3. Flag unverified claims with explicit uncertainty.
4. Downgrade records with missing links or low-detail summaries.

## Final Report Structure

1. Executive summary (3-5 lines).
2. Top hotspots ranked table.
3. Evidence details per hotspot:
source mix, URLs, and rationale.
4. Risks and unknowns.
5. Suggested next actions.

## Writing Rules

1. Use explicit timestamps (ISO datetime).
2. Separate observed facts from inference.
3. Never claim certainty when corroboration is weak.
4. Prefer concise reasoning tied to evidence URLs.
