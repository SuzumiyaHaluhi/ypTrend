# Search Sources

## Purpose

Use diversified sources so one broken endpoint does not block hotspot discovery.

## Global Sources (`search_web.py`)

1. Google News RSS:
`https://news.google.com/rss/search?q=<query>`
2. Bing News RSS:
`https://www.bing.com/news/search?q=<query>&format=rss`
3. Hacker News search API (Algolia):
`https://hn.algolia.com/api/v1/search?query=<query>&tags=story`
4. DuckDuckGo HTML (best effort parsing):
`https://duckduckgo.com/html/?q=<query>`

## Chinese Sources (`search_china.py`)

1. Zhihu hot list API:
`https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total`
2. Bilibili popular API:
`https://api.bilibili.com/x/web-interface/popular`
3. Weibo hot search endpoint (best effort, may be unstable):
`https://weibo.com/ajax/side/hotSearch`

## Twitter Source (`search_twitter.py`)

1. twitterapi.io advanced search endpoint:
`/twitter/tweet/advanced_search`
2. Required env:
`TWITTERAPI_IO_KEY`
3. Optional env:
`TWITTERAPI_IO_BASE_URL` (defaults to `https://api.twitterapi.io`)

## Reliability Notes

1. External endpoints can fail or change schema.
2. Treat HTTP failure as per-source degradation and continue.
3. Always log source status in output metadata.
4. Favor corroborated records appearing in 2+ sources.

## Compliance and Safety

1. Respect source terms of service.
2. Use moderate request frequency and timeout controls.
3. Avoid private or authenticated scraping in this skill baseline.
