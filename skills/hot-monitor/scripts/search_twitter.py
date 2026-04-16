#!/usr/bin/env python3
"""
Collect hotspot candidates from twitterapi.io (optional source).
Requires TWITTERAPI_IO_KEY.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request
from typing import Any, Dict, List

DEFAULT_TIMEOUT = 20


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def fetch_json(url: str, headers: Dict[str, str], timeout: int = DEFAULT_TIMEOUT) -> Any:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        text = resp.read().decode("utf-8", errors="ignore")
    return json.loads(text)


def flatten_tweets(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    if isinstance(payload.get("tweets"), list):
        return payload["tweets"]
    if isinstance(payload.get("data"), list):
        return payload["data"]
    data = payload.get("data")
    if isinstance(data, dict) and isinstance(data.get("tweets"), list):
        return data["tweets"]
    result = payload.get("result")
    if isinstance(result, dict) and isinstance(result.get("tweets"), list):
        return result["tweets"]
    return []


def as_num(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def map_tweet(tweet: Dict[str, Any]) -> Dict[str, Any]:
    text = (tweet.get("text") or tweet.get("full_text") or "").strip()
    author = tweet.get("user", {}) if isinstance(tweet.get("user"), dict) else {}
    name = author.get("name") or author.get("screen_name") or "Unknown"
    item_url = (
        tweet.get("url")
        or tweet.get("twitterUrl")
        or ("https://x.com/i/status/{}".format(tweet.get("id_str")) if tweet.get("id_str") else "")
    )
    likes = as_num(tweet.get("favorite_count") or tweet.get("like_count"))
    retweets = as_num(tweet.get("retweet_count"))
    quotes = as_num(tweet.get("quote_count"))
    replies = as_num(tweet.get("reply_count"))
    views = as_num(tweet.get("view_count") or tweet.get("views"))
    engagement_score = round((1.5 * likes) + (2 * retweets) + (2 * quotes) + replies + (views / 100.0), 2)

    return {
        "source": "twitterapi_io",
        "title": "{}: {}".format(name, text)[:220],
        "url": item_url,
        "summary": text,
        "published_at": tweet.get("created_at") or tweet.get("createdAt"),
        "metrics": {
            "likes": likes,
            "retweets": retweets,
            "quotes": quotes,
            "replies": replies,
            "views": views,
            "engagement_score": engagement_score,
        },
    }


def ensure_parent(path: str) -> None:
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect Twitter hotspot candidates.")
    parser.add_argument("--query", required=True, help="search query")
    parser.add_argument("--limit", type=int, default=40, help="max records")
    parser.add_argument("--output", required=True, help="output json path")
    args = parser.parse_args()

    api_key = os.environ.get("TWITTERAPI_IO_KEY", "").strip()
    base_url = os.environ.get("TWITTERAPI_IO_BASE_URL", "https://api.twitterapi.io").rstrip("/")
    ensure_parent(args.output)

    if not api_key:
        payload = {
            "query": args.query,
            "collected_at": now_iso(),
            "source_status": {"twitterapi_io": "skipped: missing TWITTERAPI_IO_KEY"},
            "item_count": 0,
            "items": [],
        }
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(json.dumps({"ok": True, "output": args.output, "item_count": 0, "skipped": True}, ensure_ascii=False))
        return 0

    endpoint = "/twitter/tweet/advanced_search"
    params = urllib.parse.urlencode({"query": args.query, "queryType": "Latest"})
    url = "{}{}?{}".format(base_url, endpoint, params)
    headers = {"X-API-Key": api_key, "Accept": "application/json"}

    status = {}
    items: List[Dict[str, Any]] = []
    try:
        raw = fetch_json(url, headers=headers)
        tweets = flatten_tweets(raw)
        for tweet in tweets:
            mapped = map_tweet(tweet)
            if mapped["url"]:
                items.append(mapped)
            if len(items) >= args.limit:
                break
        status["twitterapi_io"] = "ok"
    except Exception as exc:
        status["twitterapi_io"] = "error: {}".format(str(exc))

    output = {
        "query": args.query,
        "collected_at": now_iso(),
        "source_status": status,
        "item_count": len(items),
        "items": items,
    }
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(json.dumps({"ok": True, "output": args.output, "item_count": len(items)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
