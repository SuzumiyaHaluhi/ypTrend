#!/usr/bin/env python3
"""
Collect hotspot candidates from public global web sources.
No local ypTrend backend dependency.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any, Dict, List

DEFAULT_TIMEOUT = 15
USER_AGENT = "hot-monitor/1.0 (+https://local.skill)"


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def fetch_text(url: str, timeout: int = DEFAULT_TIMEOUT) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def fetch_json(url: str, timeout: int = DEFAULT_TIMEOUT) -> Any:
    return json.loads(fetch_text(url, timeout=timeout))


def parse_rss(xml_text: str, source: str, limit: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out

    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        summary = (item.findtext("description") or "").strip()
        published = (item.findtext("pubDate") or item.findtext("published") or "").strip()
        if not title or not link:
            continue
        out.append(
            {
                "source": source,
                "title": title,
                "url": link,
                "summary": re.sub(r"<[^>]+>", " ", summary).strip(),
                "published_at": published or None,
            }
        )
        if len(out) >= limit:
            break
    return out


def parse_duckduckgo_html(text: str, limit: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    pattern = re.compile(
        r'<a[^>]*class="result__a"[^>]*href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>',
        re.IGNORECASE | re.DOTALL,
    )
    for match in pattern.finditer(text):
        href = html.unescape(match.group("href")).strip()
        title = re.sub(r"<[^>]+>", "", html.unescape(match.group("title"))).strip()
        if href.startswith("//duckduckgo.com/l/?"):
            try:
                parsed = urllib.parse.urlparse("https:" + href)
                params = urllib.parse.parse_qs(parsed.query)
                target = params.get("uddg", [""])[0]
                href = urllib.parse.unquote(target) if target else href
            except Exception:
                pass
        if not title or not href:
            continue
        out.append(
            {
                "source": "duckduckgo_html",
                "title": title,
                "url": href,
                "summary": "",
                "published_at": None,
            }
        )
        if len(out) >= limit:
            break
    return out


def fetch_google_news(query: str, limit: int) -> List[Dict[str, Any]]:
    url = "https://news.google.com/rss/search?q={}".format(urllib.parse.quote(query))
    return parse_rss(fetch_text(url), "google_news_rss", limit)


def fetch_bing_news(query: str, limit: int) -> List[Dict[str, Any]]:
    url = "https://www.bing.com/news/search?q={}&format=rss".format(urllib.parse.quote(query))
    return parse_rss(fetch_text(url), "bing_news_rss", limit)


def fetch_hn(query: str, limit: int) -> List[Dict[str, Any]]:
    url = "https://hn.algolia.com/api/v1/search?query={}&tags=story".format(
        urllib.parse.quote(query)
    )
    payload = fetch_json(url)
    hits = payload.get("hits", []) if isinstance(payload, dict) else []
    out: List[Dict[str, Any]] = []
    for hit in hits:
        title = (hit.get("title") or "").strip()
        item_url = (hit.get("url") or "").strip()
        if not title or not item_url:
            continue
        out.append(
            {
                "source": "hackernews_algolia",
                "title": title,
                "url": item_url,
                "summary": (hit.get("story_text") or hit.get("comment_text") or "")[:280],
                "published_at": hit.get("created_at"),
            }
        )
        if len(out) >= limit:
            break
    return out


def fetch_duckduckgo(query: str, limit: int) -> List[Dict[str, Any]]:
    url = "https://duckduckgo.com/html/?q={}".format(urllib.parse.quote(query))
    text = fetch_text(url)
    return parse_duckduckgo_html(text, limit)


def normalize_url(url: str) -> str:
    try:
        parsed = urllib.parse.urlparse(url)
        params = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        clean = [(k, v) for (k, v) in params if not k.lower().startswith("utm_")]
        rebuilt = parsed._replace(query=urllib.parse.urlencode(clean), fragment="")
        return urllib.parse.urlunparse(rebuilt)
    except Exception:
        return url


def dedupe(items: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for item in items:
        key = normalize_url(item.get("url", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        item["url"] = key
        out.append(item)
        if len(out) >= limit:
            break
    return out


def ensure_parent(path: str) -> None:
    parent = urllib.parse.urlparse(path)
    if parent.scheme:
        return
    import os

    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect web hotspot candidates.")
    parser.add_argument("--query", required=True, help="search query")
    parser.add_argument("--limit", type=int, default=40, help="max merged records")
    parser.add_argument("--output", required=True, help="output json path")
    args = parser.parse_args()

    per_source = max(8, args.limit // 2)
    source_jobs = [
        ("google_news_rss", fetch_google_news),
        ("bing_news_rss", fetch_bing_news),
        ("hackernews_algolia", fetch_hn),
        ("duckduckgo_html", fetch_duckduckgo),
    ]

    merged: List[Dict[str, Any]] = []
    status: Dict[str, str] = {}

    for source_name, fn in source_jobs:
        try:
            rows = fn(args.query, per_source)
            merged.extend(rows)
            status[source_name] = "ok"
        except Exception as exc:
            status[source_name] = "error: {}".format(str(exc))

    final_items = dedupe(merged, args.limit)
    output = {
        "query": args.query,
        "collected_at": now_iso(),
        "source_status": status,
        "item_count": len(final_items),
        "items": final_items,
    }

    ensure_parent(args.output)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(json.dumps({"ok": True, "output": args.output, "item_count": len(final_items)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
