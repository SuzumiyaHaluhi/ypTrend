#!/usr/bin/env python3
"""
Merge collected JSON files and produce a Markdown hotspot report.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import urllib.parse
from typing import Any, Dict, List


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def normalize_url(url: str) -> str:
    try:
        parsed = urllib.parse.urlparse(url or "")
        params = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        clean = [(k, v) for (k, v) in params if not k.lower().startswith("utm_")]
        rebuilt = parsed._replace(query=urllib.parse.urlencode(clean), fragment="")
        return urllib.parse.urlunparse(rebuilt)
    except Exception:
        return url or ""


def load_input(path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict) and isinstance(payload.get("items"), list):
        return [x for x in payload["items"] if isinstance(x, dict)]
    return []


def dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for item in items:
        key = normalize_url(item.get("url", "")) or (item.get("title", "")[:120].strip().lower())
        if not key or key in seen:
            continue
        seen.add(key)
        item["url"] = normalize_url(item.get("url", ""))
        out.append(item)
    return out


def parse_time(value: Any) -> dt.datetime:
    if not value:
        return dt.datetime.min.replace(tzinfo=dt.timezone.utc)
    text = str(value).strip()
    if not text:
        return dt.datetime.min.replace(tzinfo=dt.timezone.utc)
    text = text.replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except Exception:
        return dt.datetime.min.replace(tzinfo=dt.timezone.utc)


def brief(text: str, limit: int = 120) -> str:
    clean = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(clean) <= limit:
        return clean
    return clean[: limit - 3] + "..."


def build_markdown(query: str, items: List[Dict[str, Any]], inputs: List[str]) -> str:
    source_counts: Dict[str, int] = {}
    for item in items:
        source = str(item.get("source") or "unknown")
        source_counts[source] = source_counts.get(source, 0) + 1

    lines: List[str] = []
    lines.append("# Hotspot Monitoring Report")
    lines.append("")
    lines.append("## Metadata")
    lines.append("")
    lines.append("- Query: `{}`".format(query))
    lines.append("- Generated at: `{}`".format(now_iso()))
    lines.append("- Total unique items: `{}`".format(len(items)))
    lines.append("- Input files:")
    for path in inputs:
        lines.append("  - `{}`".format(path))
    lines.append("")
    lines.append("## Source Distribution")
    lines.append("")
    for source, count in sorted(source_counts.items(), key=lambda x: (-x[1], x[0])):
        lines.append("- {}: {}".format(source, count))
    if not source_counts:
        lines.append("- no data")
    lines.append("")
    lines.append("## Top Candidates")
    lines.append("")
    lines.append("| # | Source | Published (raw) | Title | URL |")
    lines.append("|---|---|---|---|---|")
    for idx, item in enumerate(items[:30], start=1):
        lines.append(
            "| {} | {} | {} | {} | {} |".format(
                idx,
                str(item.get("source") or ""),
                str(item.get("published_at") or ""),
                brief(str(item.get("title") or ""), 80).replace("|", "/"),
                str(item.get("url") or "").replace("|", "%7C"),
            )
        )
    if not items:
        lines.append("| - | - | - | no candidates | - |")
    lines.append("")
    lines.append("## Analyst Notes Template")
    lines.append("")
    lines.append("For each high-priority item, fill:")
    lines.append("")
    lines.append("1. Relevance (`0-5`):")
    lines.append("2. Credibility (`0-5`):")
    lines.append("3. Timeliness (`0-5`):")
    lines.append("4. Impact (`0-5`):")
    lines.append("5. Decision: `P0` / `P1` / `P2` / `Drop`")
    lines.append("6. Reasoning and evidence links:")
    lines.append("")
    return "\n".join(lines) + "\n"


def ensure_parent(path: str) -> None:
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Merge hotspot JSON files and output Markdown report.")
    parser.add_argument("--query", required=True, help="query label in report")
    parser.add_argument("--inputs", nargs="+", required=True, help="input json files")
    parser.add_argument("--output", required=True, help="output markdown path")
    args = parser.parse_args()

    merged: List[Dict[str, Any]] = []
    for path in args.inputs:
        merged.extend(load_input(path))
    merged = dedupe(merged)
    merged.sort(key=lambda x: parse_time(x.get("published_at")), reverse=True)

    report = build_markdown(args.query, merged, args.inputs)
    ensure_parent(args.output)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(report)

    print(json.dumps({"ok": True, "output": args.output, "item_count": len(merged)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
