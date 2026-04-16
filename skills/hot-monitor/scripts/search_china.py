#!/usr/bin/env python3
"""
Collect hotspot candidates from Chinese public sources.
No local ypTrend backend dependency.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from typing import Any, Dict, List

DEFAULT_TIMEOUT = 15
USER_AGENT = "hot-monitor/1.0 (+https://local.skill)"


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def fetch_json(url: str, timeout: int = DEFAULT_TIMEOUT) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        text = resp.read().decode("utf-8", errors="ignore")
    return json.loads(text)


def query_tokens(query: str) -> List[str]:
    chunks = [x.strip().lower() for x in re.split(r"\s+", query) if x.strip()]
    if query and query.strip() and query.strip().lower() not in chunks:
        chunks.append(query.strip().lower())
    return chunks


def keyword_match(text: str, tokens: List[str]) -> bool:
    if not tokens:
        return True
    hay = (text or "").lower()
    return any(token in hay for token in tokens if token)


def fetch_zhihu(limit: int) -> List[Dict[str, Any]]:
    url = "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit={}&desktop=true".format(limit)
    payload = fetch_json(url)
    rows = payload.get("data", []) if isinstance(payload, dict) else []
    out: List[Dict[str, Any]] = []
    for row in rows:
        target = row.get("target", {}) if isinstance(row, dict) else {}
        title = (target.get("title") or "").strip()
        excerpt = (target.get("excerpt") or "").strip()
        item_id = target.get("id")
        item_url = target.get("url") or (f"https://www.zhihu.com/question/{item_id}" if item_id else "")
        if not title or not item_url:
            continue
        out.append(
            {
                "source": "zhihu_hot",
                "title": title,
                "url": item_url,
                "summary": excerpt,
                "published_at": None,
            }
        )
    return out


def fetch_bilibili(limit: int) -> List[Dict[str, Any]]:
    pages = max(1, min(3, (limit + 19) // 20))
    out: List[Dict[str, Any]] = []
    for page in range(1, pages + 1):
        url = "https://api.bilibili.com/x/web-interface/popular?ps=20&pn={}".format(page)
        payload = fetch_json(url)
        data = payload.get("data", {}) if isinstance(payload, dict) else {}
        rows = data.get("list", []) if isinstance(data, dict) else []
        for row in rows:
            title = (row.get("title") or "").strip()
            item_url = (row.get("short_link_v2") or row.get("short_link") or row.get("uri") or "").strip()
            if not title or not item_url:
                continue
            out.append(
                {
                    "source": "bilibili_popular",
                    "title": title,
                    "url": item_url,
                    "summary": (row.get("desc") or "").strip(),
                    "published_at": None,
                }
            )
    return out[:limit]


def fetch_weibo(limit: int) -> List[Dict[str, Any]]:
    url = "https://weibo.com/ajax/side/hotSearch"
    payload = fetch_json(url)
    data = payload.get("data", {}) if isinstance(payload, dict) else {}
    realtime = data.get("realtime", []) if isinstance(data, dict) else []
    out: List[Dict[str, Any]] = []
    for row in realtime:
        word = (row.get("word") or row.get("note") or "").strip()
        if not word:
            continue
        keyword = urllib.parse.quote(word)
        item_url = "https://s.weibo.com/weibo?q={}".format(keyword)
        out.append(
            {
                "source": "weibo_hot_search",
                "title": word,
                "url": item_url,
                "summary": str(row.get("num") or ""),
                "published_at": None,
            }
        )
        if len(out) >= limit:
            break
    return out


def dedupe(items: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for item in items:
        key = (item.get("url") or item.get("title") or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= limit:
            break
    return out


def ensure_parent(path: str) -> None:
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect Chinese hotspot candidates.")
    parser.add_argument("--query", required=True, help="filter keyword")
    parser.add_argument("--limit", type=int, default=40, help="max merged records")
    parser.add_argument("--output", required=True, help="output json path")
    args = parser.parse_args()

    tokens = query_tokens(args.query)
    source_jobs = [
        ("zhihu_hot", fetch_zhihu),
        ("bilibili_popular", fetch_bilibili),
        ("weibo_hot_search", fetch_weibo),
    ]

    merged: List[Dict[str, Any]] = []
    status: Dict[str, str] = {}

    for source_name, fn in source_jobs:
        try:
            rows = fn(args.limit)
            filtered = [
                row
                for row in rows
                if keyword_match("{} {}".format(row.get("title", ""), row.get("summary", "")), tokens)
            ]
            merged.extend(filtered)
            status[source_name] = "ok"
        except Exception as exc:
            status[source_name] = "error: {}".format(str(exc))

    final_items = dedupe(merged, args.limit)
    payload = {
        "query": args.query,
        "collected_at": now_iso(),
        "source_status": status,
        "item_count": len(final_items),
        "items": final_items,
    }

    ensure_parent(args.output)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(json.dumps({"ok": True, "output": args.output, "item_count": len(final_items)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
