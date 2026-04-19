const Parser = require("rss-parser");
const { config } = require("../../config");
const { normalizeUrl } = require("../../utils/common");

const parser = new Parser();

function formatProviderError(error) {
  const status = error?.response?.status;
  const message = error?.message || "Unknown error";
  return status ? `${message} (status ${status})` : String(message);
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

function buildGoogleNewsRssUrl(query, locale) {
  if (String(locale).toLowerCase().startsWith("zh")) {
    return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  }
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

function dedupeByUrl(items, limit) {
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

async function fetchLocaleFeed(query, locale, limit) {
  const feed = await parser.parseURL(buildGoogleNewsRssUrl(query, locale));
  return (feed.items || []).slice(0, limit).map((item) => ({
    source: "rss",
    sourceId: item.guid || item.id || item.link,
    title: item.title || "(untitled)",
    url: item.link,
    summary: item.contentSnippet || item.content || "",
    publishedAt: item.isoDate || item.pubDate || null,
    trustLevel: "high",
    raw: {
      engine: "google_news_rss",
      locale,
      item
    }
  })).filter((x) => x.url);
}

async function fetchFromRss(query, limit = 8) {
  const locales = Array.isArray(config.searchLocales) && config.searchLocales.length
    ? config.searchLocales
    : ["zh-CN", "en-US"];

  const perLocale = Math.max(4, Math.ceil(limit / Math.max(1, locales.length)));
  const settled = await Promise.allSettled(locales.map((locale) => fetchLocaleFeed(query, locale, perLocale)));

  const merged = [];
  const providerFailures = [];
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      merged.push(...result.value);
      continue;
    }
    providerFailures.push({
      provider: `google_news_rss:${locales[index]}`,
      error: formatProviderError(result.reason)
    });
  }

  if (!merged.length && providerFailures.length) {
    const error = new Error("RSS source collection failed");
    error.ypTrend = buildDegradedSourceAlert("RSS_SOURCE_UNAVAILABLE", "RSS source collection failed", providerFailures);
    throw error;
  }

  const alerts = [];
  if (providerFailures.length) {
    alerts.push(buildDegradedSourceAlert("RSS_SOURCE_PARTIAL_FAILURE", "RSS source partially degraded", providerFailures));
  }

  return attachSourceAlerts(dedupeByUrl(merged, limit), alerts);
}

module.exports = {
  fetchFromRss,
  __test: {
    buildDegradedSourceAlert
  }
};
