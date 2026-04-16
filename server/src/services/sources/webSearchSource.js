const axios = require("axios");
const cheerio = require("cheerio");
const { config } = require("../../config");

async function fetchFromWebSearch(query, limit = 8) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await axios.get(url, {
    timeout: config.requestTimeoutMs,
    proxy: false,
    headers: {
      "User-Agent": "Mozilla/5.0 ypTrend/1.0"
    }
  });

  const $ = cheerio.load(response.data);
  const results = [];

  $(".result").each((_, el) => {
    const title = $(el).find(".result__a").text().trim();
    let link = $(el).find(".result__a").attr("href") || "";
    const snippet = $(el).find(".result__snippet").text().trim();

    if (!title || !link) return;

    if (link.startsWith("//duckduckgo.com/l/?")) {
      try {
        const parsed = new URL(`https:${link}`);
        const target = parsed.searchParams.get("uddg");
        if (target) {
          link = decodeURIComponent(target);
        }
      } catch {
        return;
      }
    }

    results.push({
      source: "web",
      sourceId: null,
      title,
      url: link,
      summary: snippet,
      publishedAt: null,
      raw: { title, link, snippet }
    });
  });

  return results.slice(0, limit);
}

module.exports = { fetchFromWebSearch };
