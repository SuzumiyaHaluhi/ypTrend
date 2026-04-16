const Parser = require("rss-parser");
const parser = new Parser();

async function fetchFromRss(query, limit = 8) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const feed = await parser.parseURL(rssUrl);

  const items = (feed.items || []).slice(0, limit).map((item) => ({
    source: "rss",
    sourceId: item.guid || item.id || item.link,
    title: item.title || "(untitled)",
    url: item.link,
    summary: item.contentSnippet || item.content || "",
    publishedAt: item.isoDate || item.pubDate || null,
    raw: item
  }));

  return items;
}

module.exports = { fetchFromRss };
