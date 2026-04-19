const assert = require("node:assert/strict");
const { normalizeUrl, stableHash } = require("../src/utils/common");
const { isStaleRecord, resolveReferenceTimestamp } = require("../src/services/freshnessService");
const { __test: twitterQualityTest } = require("../src/services/sources/twitterSource");
const { __test: openRouterTest } = require("../src/services/openRouterService");
const { __test: webSourceTest } = require("../src/services/sources/webSearchSource");
const { __test: rssSourceTest } = require("../src/services/sources/rssSource");
const { computeSignalScore, resolveSignalTier } = require("../src/services/signalScoringService");
const { updateSettingsSchema } = require("../src/routes/schemas");

function run(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

run("normalizeUrl removes tracker params", () => {
  const out = normalizeUrl("https://example.com/a?utm_source=x&ok=1");
  assert.match(out, /ok=1/);
  assert.doesNotMatch(out, /utm_source/);
});

run("stableHash deterministic", () => {
  assert.equal(stableHash("abc"), stableHash("abc"));
});

run("freshness window marks stale data older than 7 days", () => {
  const nowMs = Date.parse("2026-04-16T12:00:00.000Z");
  const stale = { publishedAt: "2026-04-08T11:59:59.000Z" };
  assert.equal(isStaleRecord(stale, { nowMs, windowDays: 7 }), true);
});

run("freshness window keeps data within 7 days", () => {
  const nowMs = Date.parse("2026-04-16T12:00:00.000Z");
  const fresh = { publishedAt: "2026-04-10T12:00:00.000Z" };
  assert.equal(isStaleRecord(fresh, { nowMs, windowDays: 7 }), false);
});

run("freshness resolver falls back to discovered time", () => {
  const ts = resolveReferenceTimestamp({
    publishedAt: "invalid-date",
    discoveredAt: "2026-04-12T08:00:00.000Z"
  });
  assert.equal(ts, Date.parse("2026-04-12T08:00:00.000Z"));
});

run("twitter quality uses likes*1.5 scoring formula", () => {
  const score = twitterQualityTest.calculateEngagementScore({
    likes: 100,
    retweets: 10,
    quotes: 5,
    replies: 20,
    views: 10000
  });
  assert.equal(score, 300);
});

run("twitter quality marks quote tweet as non-original", () => {
  const quality = twitterQualityTest.evaluateTweetQuality(
    {
      text: "quoted tweet",
      is_quote_status: true,
      favorite_count: 999
    },
    { minEngagementScore: 500, minFollowers: 1000 }
  );
  assert.equal(quality.keep, false);
  assert.equal(quality.reason, "quote_not_original");
});

run("twitter quality marks high engagement tier at 2000+", () => {
  const tier = twitterQualityTest.resolveEngagementTier(2000);
  assert.equal(tier, "high");
});

run("twitter api 402 credits error is classified explicitly", () => {
  const classified = twitterQualityTest.classifyTwitterApiError({
    response: {
      status: 402,
      data: {
        error: "Unauthorized",
        message: "Credits is not enough.Please recharge"
      }
    }
  });
  assert.equal(classified.code, "TWITTER_CREDITS_EXHAUSTED");
  assert.equal(classified.userMessage, "Twitter credits exhausted");
});

run("twitter retweet can pass when excludeRetweets disabled", () => {
  const quality = twitterQualityTest.evaluateTweetQuality(
    {
      text: "RT @openai big launch update with enough detail",
      retweeted_status: { id: "1" },
      favorite_count: 1200,
      retweet_count: 300,
      quote_count: 50,
      reply_count: 80,
      view_count: 100000,
      user: { followers_count: 200000, verified: true }
    },
    { minEngagementScore: 500, minFollowers: 1000, excludeRetweets: false }
  );
  assert.equal(quality.keep, true);
  assert.equal(quality.isRetweet, true);
  assert.equal(quality.isOriginal, false);
});

run("missing OpenRouter API key fallback disables notifications", () => {
  const evaluation = openRouterTest.buildMissingApiKeyEvaluation({
    monitor: { type: "keyword", query: "OpenAI launch" },
    item: { title: "Completely unrelated sports update", summary: "" },
    model: "google/gemma-4-31b-it:free"
  });
  assert.equal(evaluation.isRelevant, false);
  assert.equal(evaluation.shouldNotify, false);
  assert.match(evaluation.reason, /Notifications disabled/);
});

run("settings schema allows empty Feishu webhook", () => {
  const parsed = updateSettingsSchema.safeParse({
    notification: {
      feishuWebhook: ""
    }
  });
  assert.equal(parsed.success, true);
});

run("web source degraded alert includes failed providers", () => {
  const alert = webSourceTest.buildDegradedSourceAlert("WEB_SOURCE_PARTIAL_FAILURE", "Web source partially degraded", [
    { provider: "duckduckgo_html", error: "timeout" },
    { provider: "bing_news:zh-CN", error: "503" }
  ]);
  assert.equal(alert.code, "WEB_SOURCE_PARTIAL_FAILURE");
  assert.match(alert.detail, /duckduckgo_html: timeout/);
  assert.match(alert.detail, /bing_news:zh-CN: 503/);
});

run("rss source degraded alert includes failed providers", () => {
  const alert = rssSourceTest.buildDegradedSourceAlert("RSS_SOURCE_PARTIAL_FAILURE", "RSS source partially degraded", [
    { provider: "google_news_rss:zh-CN", error: "ECONNRESET" }
  ]);
  assert.equal(alert.code, "RSS_SOURCE_PARTIAL_FAILURE");
  assert.match(alert.detail, /google_news_rss:zh-CN: ECONNRESET/);
});

run("web/rss signal score reaches high tier at strong corroboration", () => {
  const { score } = computeSignalScore({
    item: {
      source: "rss",
      raw: { engine: "google_news_rss" },
      title: "OpenAI发布新模型",
      summary: "官方博客更新并给出技术细节",
      publishedAt: "2026-04-16T10:00:00.000Z"
    },
    crossSourceCount: 3,
    confidence: 0.9,
    nowMs: Date.parse("2026-04-16T12:00:00.000Z")
  });
  assert.equal(score, 99);
  assert.equal(resolveSignalTier(score, 70), "high");
});

run("web/rss signal score falls into medium tier around boundary", () => {
  const { score } = computeSignalScore({
    item: {
      source: "web",
      raw: { engine: "bing_web" },
      title: "AI coding update",
      summary: "",
      publishedAt: "2026-04-14T12:00:00.000Z"
    },
    crossSourceCount: 2,
    confidence: 0.5,
    nowMs: Date.parse("2026-04-16T12:00:00.000Z")
  });
  assert.equal(score, 58);
  assert.equal(resolveSignalTier(score, 70), "medium");
});

run("web/rss signal tier obeys configurable high threshold", () => {
  assert.equal(resolveSignalTier(75, 80), "medium");
  assert.equal(resolveSignalTier(80, 80), "high");
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
