const axios = require("axios");
const cheerio = require("cheerio");
const Parser = require("rss-parser");
const { config } = require("../../config");
const { normalizeUrl } = require("../../utils/common");

const parser = new Parser();

function formatProviderError(error) {
  const status = error?.response?.status;
  const baseMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    "Unknown error";
  return status ? `${baseMessage} (status ${status})` : String(baseMessage);
}

function buildDegradedSourceAlert(code, userMessage, providerFailures) {
  return {
    code,
    severity: "warning",
    userMessage,
    detail: providerFailures.map(({ provider, error }) => `${provider}: ${error}`).join("; ")
  };
}

function attachSourceAlerts(items, alerts) {
  if (!Array.isArray(items) || !Array.isArray(alerts) || !alerts.length) {
    return items;
  }
  items.ypTrendAlerts = alerts;
  return items;
}

function toLangTag(locale) {
  const value = String(locale || "").toLowerCase();
  if (value.startsWith("zh")) return "zh-Hans";
  if (value.startsWith("en")) return "en-US";
  return "en-US";
}

async function fetchDuckDuckGo(query, limit) {
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
        if (target) link = decodeURIComponent(target);
      } catch {
        return;
      }
    }

    results.push({
      source: "web",
      sourceId: `duckduckgo:${normalizeUrl(link)}`,
      title,
      url: link,
      summary: snippet,
      publishedAt: null,
      trustLevel: "medium",
      raw: {
        engine: "duckduckgo",
        locale: "global",
        title,
        link,
        snippet
      }
    });
  });

  return results.slice(0, limit);
}

async function fetchBingRss({ query, limit, locale, type }) {
  const setlang = toLangTag(locale);
  const endpoint = type === "news" ? "https://www.bing.com/news/search" : "https://www.bing.com/search";
  const url = `${endpoint}?q=${encodeURIComponent(query)}&format=rss&setlang=${encodeURIComponent(setlang)}`;
  const feed = await parser.parseURL(url);
  const engine = type === "news" ? "bing_news" : "bing_web";

  return (feed.items || []).slice(0, limit).map((item) => ({
    source: "web",
    sourceId: `${engine}:${item.guid || item.id || item.link || ""}`,
    title: item.title || "(untitled)",
    url: item.link,
    summary: item.contentSnippet || item.content || "",
    publishedAt: item.isoDate || item.pubDate || null,
    trustLevel: type === "news" ? "high" : "medium",
    raw: {
      engine,
      locale,
      feedTitle: feed.title || "",
      item
    }
  })).filter((x) => x.url);
}

function dedupeResults(items, limit) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = normalizeUrl(item.url || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchFromWebSearch(query, limit = 8) {
  const locales = Array.isArray(config.searchLocales) && config.searchLocales.length
    ? config.searchLocales
    : ["zh-CN", "en-US"];

  const perEngine = Math.max(4, Math.ceil(limit / 2));
  const tasks = [{ provider: "duckduckgo_html", run: () => fetchDuckDuckGo(query, perEngine) }];

  for (const locale of locales) {
    tasks.push({
      provider: `bing_web:${locale}`,
      run: () => fetchBingRss({ query, limit: perEngine, locale, type: "web" })
    });
    tasks.push({
      provider: `bing_news:${locale}`,
      run: () => fetchBingRss({ query, limit: perEngine, locale, type: "news" })
    });
  }

  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  const merged = [];
  const providerFailures = [];
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      merged.push(...result.value);
      continue;
    }
    providerFailures.push({
      provider: tasks[index].provider,
      error: formatProviderError(result.reason)
    });
  }

  if (!merged.length && providerFailures.length) {
    const error = new Error("Web source collection failed");
    error.ypTrend = buildDegradedSourceAlert("WEB_SOURCE_UNAVAILABLE", "Web source collection failed", providerFailures);
    throw error;
  }

  const alerts = [];
  if (providerFailures.length) {
    alerts.push(buildDegradedSourceAlert("WEB_SOURCE_PARTIAL_FAILURE", "Web source partially degraded", providerFailures));
  }

  return attachSourceAlerts(dedupeResults(merged, limit), alerts);
}

module.exports = {
  fetchFromWebSearch,
  __test: {
    buildDegradedSourceAlert
  }
};
