const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function toJournalMode(value, fallback = "DELETE") {
  const raw = (value || fallback || "DELETE").toString().trim().toUpperCase();
  const allowed = new Set(["DELETE", "TRUNCATE", "PERSIST", "MEMORY", "WAL", "OFF"]);
  return allowed.has(raw) ? raw : fallback;
}

function toCsvList(value, fallback = []) {
  const input = value === undefined || value === null || value === "" ? fallback.join(",") : String(value);
  return input
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

const defaultDbFallback = (process.env.NODE_ENV || "development") !== "production";

const config = {
  port: toNumber(process.env.PORT, 8787),
  env: process.env.NODE_ENV || "development",
  dbFile: process.env.DB_FILE || ":memory:",
  dbAllowMemoryFallback: toBoolean(process.env.DB_ALLOW_MEMORY_FALLBACK, defaultDbFallback),
  sqliteJournalMode: toJournalMode(process.env.SQLITE_JOURNAL_MODE, "MEMORY"),
  openRouterApiKey: process.env.OPENROUTER_API_KEY || "",
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  openRouterReferer: process.env.OPENROUTER_REFERER || "https://yptrend.local",
  openRouterTitle: process.env.OPENROUTER_TITLE || "ypTrend",
  twitterApiKey: process.env.TWITTERAPI_IO_KEY || "",
  twitterApiBaseUrl: process.env.TWITTERAPI_IO_BASE_URL || "https://api.twitterapi.io",
  twitterMinEngagementScore: toNumber(process.env.TWITTER_MIN_ENGAGEMENT_SCORE, 500),
  twitterNotifyMinEngagementScore: toNumber(process.env.TWITTER_NOTIFY_MIN_ENGAGEMENT_SCORE, 2000),
  twitterReplyMinEngagementScore: toNumber(process.env.TWITTER_REPLY_MIN_ENGAGEMENT_SCORE, 30),
  twitterMinFollowers: toNumber(process.env.TWITTER_MIN_FOLLOWERS, 1000),
  twitterExcludeRetweets: toBoolean(process.env.TWITTER_EXCLUDE_RETWEETS, true),
  feishuWebhook: process.env.FEISHU_WEBHOOK || "",
  feishuKeyword: process.env.FEISHU_KEYWORD || "trend",
  reliabilityLowTrustRequireCrossSource: toBoolean(process.env.LOW_TRUST_REQUIRE_CROSS_SOURCE, true),
  reliabilityMinDistinctSources: toNumber(process.env.RELIABILITY_MIN_DISTINCT_SOURCES, 2),
  nonTwitterSignalHighThreshold: Math.max(50, Math.min(100, toNumber(process.env.NON_TWITTER_SIGNAL_HIGH_THRESHOLD, 70))),
  freshnessWindowDays: Math.max(1, toNumber(process.env.FRESHNESS_WINDOW_DAYS, 7)),
  searchLocales: toCsvList(process.env.SEARCH_LOCALES, ["zh-CN", "en-US"]),
  defaultScanLimitPerSource: toNumber(process.env.DEFAULT_SCAN_LIMIT_PER_SOURCE, 8),
  requestTimeoutMs: toNumber(process.env.REQUEST_TIMEOUT_MS, 15000)
};

module.exports = { config };


