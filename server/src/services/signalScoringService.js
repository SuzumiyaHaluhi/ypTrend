function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseTimeMs(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : null;
}

function resolveSourceAuthority(item = {}) {
  if (item.source === "rss") return 35;
  if (item.source !== "web") return 0;

  const engine = String(item.raw?.engine || "").toLowerCase();
  if (engine === "bing_news") return 32;
  if (engine === "bing_web") return 24;
  if (engine === "duckduckgo") return 18;
  return 20;
}

function resolveRecencyScore(item = {}, nowMs = Date.now()) {
  const publishedMs = parseTimeMs(item.publishedAt || item.published_at);
  if (!publishedMs) return 0;
  const ageHours = Math.max(0, (nowMs - publishedMs) / (1000 * 60 * 60));

  if (ageHours <= 6) return 25;
  if (ageHours <= 24) return 20;
  if (ageHours <= 72) return 12;
  if (ageHours <= 168) return 4;
  return 0;
}

function resolveCorroborationScore(crossSourceCount = 1) {
  if (crossSourceCount >= 3) return 25;
  if (crossSourceCount >= 2) return 15;
  return 0;
}

function resolveContentQualityScore(item = {}) {
  const hasTitle = Boolean(String(item.title || "").trim());
  const hasSummary = Boolean(String(item.summary || "").trim());
  if (hasTitle && hasSummary) return 5;
  if (hasTitle) return 2;
  return 0;
}

function resolveAiConfidenceBonus(confidence = 0) {
  const normalized = Math.min(1, Math.max(0, toNumber(confidence, 0)));
  return Math.round(normalized * 10);
}

function computeSignalScore({
  item,
  crossSourceCount = 1,
  confidence = 0,
  nowMs = Date.now()
}) {
  const sourceAuthority = resolveSourceAuthority(item);
  const recency = resolveRecencyScore(item, nowMs);
  const corroboration = resolveCorroborationScore(crossSourceCount);
  const contentQuality = resolveContentQualityScore(item);
  const aiConfidenceBonus = resolveAiConfidenceBonus(confidence);
  const total = sourceAuthority + recency + corroboration + contentQuality + aiConfidenceBonus;

  return {
    score: Math.max(0, Math.min(100, total)),
    parts: {
      sourceAuthority,
      recency,
      corroboration,
      contentQuality,
      aiConfidenceBonus
    }
  };
}

function resolveSignalTier(signalScore, highThreshold = 70) {
  const high = Math.max(50, Math.min(100, toNumber(highThreshold, 70)));
  const score = toNumber(signalScore, 0);
  if (score >= high) return "high";
  if (score >= 50) return "medium";
  return "low";
}

module.exports = {
  computeSignalScore,
  resolveSignalTier,
  __test: {
    resolveSourceAuthority,
    resolveRecencyScore,
    resolveCorroborationScore,
    resolveContentQualityScore,
    resolveAiConfidenceBonus
  }
};
