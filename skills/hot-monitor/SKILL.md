---
name: hot-monitor
description: Self-contained hotspot discovery and analysis workflow that does not depend on the ypTrend backend service. Use when you need to collect trend signals directly from open web sources, Chinese public platforms, and optional Twitter API, then produce a ranked Markdown hotspot report with relevance, credibility, and importance judgments.
---

# Hot Monitor

## Overview

Collect candidate hotspots from multiple external sources, then synthesize a final report.
Use this skill when the user wants a lightweight, portable trend monitor that runs from scripts alone.

## Input Contract

1. Ask for:
query keywords, target language/region, desired time focus, and report depth.
2. Choose output directory:
default to `skills/hot-monitor/output/`.
3. Require no local ypTrend server.
4. Accept optional credentials:
`TWITTERAPI_IO_KEY` for Twitter collection.

## Workflow Decision Tree

1. Need broad global trend capture:
Run `scripts/search_web.py`.
2. Need Chinese ecosystem coverage:
Run `scripts/search_china.py`.
3. Need social momentum from X:
Run `scripts/search_twitter.py` when `TWITTERAPI_IO_KEY` is available.
4. Need final deliverable:
Run `scripts/generate_report.py`, then apply `references/analysis-guide.md` for final ranking and judgment narrative.

## Standard Execution Flow

1. Create output directory:
`mkdir -p skills/hot-monitor/output`
2. Collect global web signals:
`python skills/hot-monitor/scripts/search_web.py --query "<query>" --limit 40 --output skills/hot-monitor/output/web.json`
3. Collect Chinese signals:
`python skills/hot-monitor/scripts/search_china.py --query "<query>" --limit 40 --output skills/hot-monitor/output/china.json`
4. Collect Twitter signals (optional):
`python skills/hot-monitor/scripts/search_twitter.py --query "<query>" --limit 40 --output skills/hot-monitor/output/twitter.json`
5. Generate merged report draft:
`python skills/hot-monitor/scripts/generate_report.py --query "<query>" --inputs skills/hot-monitor/output/web.json skills/hot-monitor/output/china.json skills/hot-monitor/output/twitter.json --output skills/hot-monitor/output/report.md`
6. Refine final analysis with rubric:
apply `references/analysis-guide.md` and add an executive summary.

## Output Contract

Produce:

1. One merged Markdown report with:
top findings, source evidence, confidence notes, and action priority.
2. Absolute date stamps in ISO format.
3. Explicit uncertainty statements for weakly corroborated items.

## References

1. Source behavior and caveats:
`references/search-sources.md`
2. Analysis rubric for final judgment:
`references/analysis-guide.md`

## Scripts

1. `scripts/search_web.py`
Collect global web hotspots from RSS and public APIs.
2. `scripts/search_china.py`
Collect Chinese trend signals from public endpoints.
3. `scripts/search_twitter.py`
Collect Twitter/X signals through twitterapi.io when key is present.
4. `scripts/generate_report.py`
Merge JSON outputs, dedupe records, and generate Markdown report.

## Guardrails

1. Never require local `server/` startup for this skill.
2. Treat external source failures as partial degradation, not full failure.
3. Do not fabricate evidence when sources return empty data.
4. Mark every conclusion with source-backed reasoning and confidence.
