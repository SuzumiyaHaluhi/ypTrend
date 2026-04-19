const { db } = require("../db");
const { normalizeUrl, stableHash, nowIso } = require("../utils/common");
const { fetchFromTwitter } = require("./sources/twitterSource");
const { fetchFromWebSearch } = require("./sources/webSearchSource");
const { fetchFromRss } = require("./sources/rssSource");
const { evaluateItem } = require("./openRouterService");
const { sendFeishuNotification } = require("./feishuService");
const { getSettings } = require("./settingsService");
const { eventBus } = require("./eventBus");
const { isStaleRecord, pruneStaleRecords, FRESHNESS_WINDOW_DAYS } = require("./freshnessService");
const { computeSignalScore, resolveSignalTier } = require("./signalScoringService");

let isRunning = false;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "at", "from", "by", "is", "are", "be", "this", "that",
  "ai", "news", "update", "today", "new", "发布", "消息", "关于", "以及", "一个", "我们", "你们", "他们", "这个", "那个", "热点"
]);

function listEnabledMonitors() {
  return db.prepare("SELECT * FROM monitors WHERE enabled = 1 ORDER BY id DESC").all();
}

function upsertHotItem(item) {
  const url = normalizeUrl(item.url);
  const uniqueHash = stableHash(`${item.source}|${url}|${(item.title || "").slice(0, 120)}`);

  const result = db.prepare(`
    INSERT OR IGNORE INTO hot_items
    (source, source_id, title, url, summary, published_at, engagement_score, view_count, engagement_tier, signal_score, signal_tier, trust_level, unique_hash, discovered_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.source,
    item.sourceId || null,
    item.title,
    url,
    item.summary || null,
    item.publishedAt || null,
    item.engagementScore ?? null,
    item.viewCount ?? null,
    item.engagementTier || null,
    item.signalScore ?? null,
    item.signalTier || null,
    item.trustLevel || null,
    uniqueHash,
    nowIso(),
    JSON.stringify(item.raw || {})
  );

  const row = db.prepare("SELECT * FROM hot_items WHERE unique_hash = ?").get(uniqueHash);
  return { row, isNew: result.changes > 0 };
}

function updateHotItemQuality(hotItemId, quality = {}) {
  db.prepare(`
    UPDATE hot_items
    SET engagement_score = ?,
        view_count = ?,
        engagement_tier = ?,
        signal_score = ?,
        signal_tier = ?,
        trust_level = ?
    WHERE id = ?
  `).run(
    quality.engagementScore ?? null,
    quality.viewCount ?? null,
    quality.engagementTier || null,
    quality.signalScore ?? null,
    quality.signalTier || null,
    quality.trustLevel || null,
    hotItemId
  );
  return db.prepare("SELECT * FROM hot_items WHERE id = ?").get(hotItemId);
}

function saveEvaluation({ hotItemId, monitorId, evalResult }) {
  db.prepare(`
    INSERT INTO ai_evaluations
    (hot_item_id, monitor_id, model, is_relevant, is_credible, confidence, reason, should_notify, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    hotItemId,
    monitorId,
    evalResult.model,
    evalResult.isRelevant ? 1 : 0,
    evalResult.isCredible ? 1 : 0,
    evalResult.confidence,
    evalResult.reason,
    evalResult.shouldNotify ? 1 : 0,
    nowIso()
  );
}

function saveNotification({ hotItemId, monitorId, status, payload, sentAt }) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO notifications
    (hot_item_id, monitor_id, channel, payload, status, sent_at, created_at)
    VALUES (?, ?, 'feishu', ?, ?, ?, ?)
  `).run(hotItemId, monitorId, JSON.stringify(payload || {}), status, sentAt || null, nowIso());
  return result.changes > 0;
}

function loadNotification(hotItemId, monitorId) {
  return db.prepare(`
    SELECT
      n.*,
      h.source,
      h.title,
      h.url,
      h.engagement_score,
      h.view_count,
      h.engagement_tier,
      h.signal_score,
      h.signal_tier,
      h.trust_level,
      m.query AS monitor_query,
      ae.model AS ai_model,
      ae.is_relevant AS ai_is_relevant,
      ae.is_credible AS ai_is_credible,
      ae.confidence AS ai_confidence,
      ae.reason AS ai_reason,
      ae.should_notify AS ai_should_notify
    FROM notifications n
    JOIN hot_items h ON h.id = n.hot_item_id
    JOIN monitors m ON m.id = n.monitor_id
    LEFT JOIN ai_evaluations ae ON ae.id = (
      SELECT ae2.id
      FROM ai_evaluations ae2
      WHERE ae2.hot_item_id = n.hot_item_id AND ae2.monitor_id = n.monitor_id
      ORDER BY ae2.id DESC
      LIMIT 1
    )
    WHERE n.hot_item_id = ? AND n.monitor_id = ? AND n.channel = 'feishu'
    LIMIT 1
  `).get(hotItemId, monitorId);
}

function hasNotified(hotItemId, monitorId) {
  const row = db.prepare("SELECT id FROM notifications WHERE hot_item_id = ? AND monitor_id = ? AND channel = 'feishu'").get(hotItemId, monitorId);
  return Boolean(row);
}

function buildPipelineAlert({ source, monitor, code, severity = "warning", message, detail, stage = "collect" }) {
  const normalizedSource = source || "unknown";
  const monitorQuery = monitor || "unknown";
  const alertMessage = message || `${normalizedSource} ${stage} failed`;
  return {
    key: `${stage}:${normalizedSource}:${code || alertMessage}`,
    code: code || "PIPELINE_ALERT",
    severity,
    source: normalizedSource,
    stage,
    monitor: monitorQuery,
    message: alertMessage,
    detail: detail || "",
    displayMessage:
      code === "TWITTER_CREDITS_EXHAUSTED"
        ? "Twitter credits exhausted: twitterapi.io credits not enough. Please recharge."
        : `[${normalizedSource}] ${alertMessage}${detail ? ` - ${detail}` : ""}`,
    ts: nowIso()
  };
}

function logPipelineAlert(alert) {
  const level = alert.severity === "error" ? "error" : "warn";
  console[level](
    `[ypTrend][ALERT][${alert.source}:${alert.stage}] ${alert.message}` +
      `${alert.monitor ? ` | monitor=${alert.monitor}` : ""}` +
      `${alert.code ? ` | code=${alert.code}` : ""}` +
      `${alert.detail ? ` | detail=${alert.detail}` : ""}`
  );
}

function emitPipelineAlert(alert, emittedAlerts, alerts) {
  if (!alert || emittedAlerts.has(alert.key)) return;
  emittedAlerts.add(alert.key);
  alerts.push(alert);
  logPipelineAlert(alert);
  eventBus.emit("realtime-event", {
    type: "system_alert",
    data: alert
  });
}

function emitCollectedSourceAlerts({ source, monitor, collected, emittedAlerts, alerts }) {
  if (!Array.isArray(collected) || !Array.isArray(collected.ypTrendAlerts)) return;
  for (const alert of collected.ypTrendAlerts) {
    emitPipelineAlert(
      buildPipelineAlert({
        source,
        monitor,
        stage: "collect",
        code: alert.code,
        severity: alert.severity || "warning",
        message: alert.userMessage || `${source} collect degraded`,
        detail: alert.detail
      }),
      emittedAlerts,
      alerts
    );
  }
}

async function collectBySource(source, query, limit, settings) {
  if (source === "twitter") return fetchFromTwitter(query, limit, settings.twitterQuality || {});
  if (source === "web") return fetchFromWebSearch(query, limit);
  if (source === "rss") return fetchFromRss(query, limit);
  return [];
}

function extractTopicTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && !STOPWORDS.has(x));
}

function buildTopicKey(monitor, item) {
  const seed = `${monitor.query || ""} ${item.title || ""} ${item.summary || ""}`;
  const tokens = extractTopicTokens(seed);
  if (!tokens.length) {
    return stableHash(`${monitor.query || ""}|${normalizeUrl(item.url || "")}`);
  }
  return stableHash(tokens.slice(0, 12).join("|"));
}

function detectTrustLevel(item) {
  if (item.trustLevel) return item.trustLevel;
  if (item.source === "rss") return "high";
  if (item.source === "web") {
    const engine = String(item.raw?.engine || "");
    if (engine.includes("news")) return "high";
    return "medium";
  }
  if (item.source === "twitter") return "low";
  return "medium";
}

function interleaveBySource(sourceOrder, collectedBySource) {
  const queues = sourceOrder.map((src) => ({ src, list: [...(collectedBySource[src] || [])] }));
  const out = [];
  let progressed = true;

  while (progressed) {
    progressed = false;
    for (const q of queues) {
      const next = q.list.shift();
      if (!next) continue;
      out.push(next);
      progressed = true;
    }
  }

  return out;
}

function annotateCandidates({ monitor, sourceOrder, collectedBySource, minDistinctSources }) {
  const ordered = interleaveBySource(sourceOrder, collectedBySource);
  const topicSourceMap = new Map();

  for (const item of ordered) {
    const topicKey = buildTopicKey(monitor, item);
    item.__topicKey = topicKey;
    if (!topicSourceMap.has(topicKey)) topicSourceMap.set(topicKey, new Set());
    topicSourceMap.get(topicKey).add(item.source);
  }

  return ordered.map((item) => {
    const crossSourceCount = topicSourceMap.get(item.__topicKey)?.size || 1;
    return {
      ...item,
      trustLevel: detectTrustLevel(item),
      crossSourceCount,
      hasCrossSourceCorroboration: crossSourceCount >= minDistinctSources
    };
  });
}

function resolveCandidateEngagementTier(candidate) {
  return candidate?.raw?.quality?.engagementTier || candidate?.engagementTier || null;
}

function resolveCandidateEngagementScore(candidate) {
  return candidate?.raw?.quality?.engagementScore ?? candidate?.engagementScore ?? null;
}

function resolveCandidateViewCount(candidate) {
  return candidate?.raw?.quality?.views ?? candidate?.viewCount ?? null;
}

function buildCandidateQualitySnapshot({ item, settings, confidence = 0 }) {
  const trustLevel = item.trustLevel || detectTrustLevel(item);
  const snapshot = {
    trustLevel,
    engagementScore: resolveCandidateEngagementScore(item),
    viewCount: resolveCandidateViewCount(item),
    engagementTier: resolveCandidateEngagementTier(item),
    signalScore: null,
    signalTier: null
  };

  if (item.source !== "twitter") {
    const signalScoreResult = computeSignalScore({
      item,
      crossSourceCount: item.crossSourceCount,
      confidence
    });
    snapshot.signalScore = signalScoreResult.score;
    snapshot.signalTier = resolveSignalTier(
      signalScoreResult.score,
      settings?.nonTwitterSignal?.highThreshold
    );
  }

  return snapshot;
}

function isSourceHighTierForNotify(item, qualitySnapshot) {
  if (item.source === "twitter") {
    const twitterNotifyThreshold = Number(qualitySnapshot.twitterNotifyThreshold);
    const engagementScore = Number(qualitySnapshot.engagementScore);
    if (!Number.isFinite(engagementScore)) return false;
    if (Number.isFinite(twitterNotifyThreshold)) {
      return engagementScore >= Math.max(0, twitterNotifyThreshold);
    }
    return qualitySnapshot.engagementTier === "high";
  }
  return qualitySnapshot.signalTier === "high";
}

async function runPipeline({ source } = {}) {
  if (isRunning) {
    return { ok: false, message: "Pipeline is already running" };
  }

  isRunning = true;
  try {
    const settings = getSettings();
    const freshnessPruneResult = pruneStaleRecords();
    const monitors = listEnabledMonitors();

    if (!monitors.length) {
      return {
        ok: true,
        message: "No enabled monitors",
        processed: 0,
        notified: 0,
        errors: [],
        alerts: [],
        freshnessWindowDays: FRESHNESS_WINDOW_DAYS,
        staleCleanup: freshnessPruneResult
      };
    }

    const sourceOrder = source ? [source] : ["twitter", "web", "rss"];
    let processed = 0;
    let notified = 0;
    const errors = [];
    const alerts = [];
    const emittedAlerts = new Set();
    const sourceStats = {
      twitter: { collected: 0, processed: 0, notified: 0, skippedLowTrustNoCorroboration: 0, skippedStaleWindow: 0, skippedNotHighTier: 0 },
      web: { collected: 0, processed: 0, notified: 0, skippedLowTrustNoCorroboration: 0, skippedStaleWindow: 0, skippedNotHighTier: 0 },
      rss: { collected: 0, processed: 0, notified: 0, skippedLowTrustNoCorroboration: 0, skippedStaleWindow: 0, skippedNotHighTier: 0 }
    };

    for (const monitor of monitors) {
      const collectedBySource = {};

      for (const src of sourceOrder) {
        try {
          const collected = await collectBySource(src, monitor.query, settings.limits.perSource, settings);
          collectedBySource[src] = collected;
          sourceStats[src].collected += collected.length;
          emitCollectedSourceAlerts({
            source: src,
            monitor: monitor.query,
            collected,
            emittedAlerts,
            alerts
          });
        } catch (error) {
          const classification = error?.ypTrend;
          errors.push({
            source: src,
            monitor: monitor.query,
            stage: "collect",
            message: error.message,
            code: classification?.code,
            severity: classification?.severity,
            detail: classification?.detail
          });
          emitPipelineAlert(
            buildPipelineAlert({
              source: src,
              monitor: monitor.query,
              stage: "collect",
              code: classification?.code,
              severity: classification?.severity || "warning",
              message: classification?.userMessage || `${src} collect failed`,
              detail: classification?.detail || error.message
            }),
            emittedAlerts,
            alerts
          );
          collectedBySource[src] = [];
        }
      }

      const candidates = annotateCandidates({
        monitor,
        sourceOrder,
        collectedBySource,
        minDistinctSources: settings.reliability?.minDistinctSources || 2
      });

      for (const item of candidates) {
        const staleByFreshnessWindow = isStaleRecord({
          publishedAt: item.publishedAt,
          discoveredAt: item.discoveredAt,
          createdAt: item.createdAt
        });
        if (staleByFreshnessWindow) {
          if (sourceStats[item.source]) {
            sourceStats[item.source].skippedStaleWindow += 1;
          }
          continue;
        }

        const initialQuality = buildCandidateQualitySnapshot({
          item,
          settings,
          confidence: 0
        });

        const { row: hotItem, isNew } = upsertHotItem({
          ...item,
          ...initialQuality
        });
        if (isNew) {
          eventBus.emit("realtime-event", { type: "hot_item", data: hotItem });
        }

        processed += 1;
        if (sourceStats[item.source]) sourceStats[item.source].processed += 1;

        let evalResult;
        let hotItemWithQuality = hotItem;
        try {
          evalResult = await evaluateItem({ monitor, item: hotItem });
          saveEvaluation({ hotItemId: hotItem.id, monitorId: monitor.id, evalResult });
          const finalQuality = buildCandidateQualitySnapshot({
            item,
            settings,
            confidence: evalResult.confidence
          });
          hotItemWithQuality = updateHotItemQuality(hotItem.id, finalQuality);
          if (isNew && hotItemWithQuality) {
            eventBus.emit("realtime-event", { type: "hot_item", data: hotItemWithQuality });
          }
        } catch (error) {
          errors.push({ source: item.source, monitor: monitor.query, stage: "evaluate", item: hotItem.url, message: error.message });
          continue;
        }

        if (!evalResult.shouldNotify || !evalResult.isRelevant || !evalResult.isCredible) {
          continue;
        }

        const finalQuality = {
          engagementScore: hotItemWithQuality?.engagement_score,
          engagementTier: hotItemWithQuality?.engagement_tier,
          signalTier: hotItemWithQuality?.signal_tier,
          twitterNotifyThreshold: settings?.twitterQuality?.notifyMinEngagementScore
        };
        if (!isSourceHighTierForNotify(item, finalQuality)) {
          if (sourceStats[item.source]) {
            sourceStats[item.source].skippedNotHighTier += 1;
          }
          continue;
        }

        if (hasNotified(hotItem.id, monitor.id)) {
          continue;
        }

        const requireCorroboration = Boolean(settings.reliability?.lowTrustRequireCrossSource);
        if (requireCorroboration && item.trustLevel === "low" && !item.hasCrossSourceCorroboration) {
          if (sourceStats[item.source]) {
            sourceStats[item.source].skippedLowTrustNoCorroboration += 1;
          }
          continue;
        }

        try {
          const sendResult = await sendFeishuNotification({
            webhook: settings.notification.feishuWebhook,
            keyword: settings.notification.feishuKeyword,
            monitor,
            item: hotItemWithQuality || hotItem,
            evaluation: evalResult
          });

          const inserted = saveNotification({
            hotItemId: hotItem.id,
            monitorId: monitor.id,
            status: sendResult.status,
            payload: sendResult.payload,
            sentAt: sendResult.ok ? nowIso() : null
          });

          if (inserted) {
            const latestNotification = loadNotification(hotItem.id, monitor.id);
            if (latestNotification) {
              eventBus.emit("realtime-event", { type: "notification", data: latestNotification });
            }
          }

          if (sendResult.ok) {
            notified += 1;
            if (sourceStats[item.source]) sourceStats[item.source].notified += 1;
          }
        } catch (error) {
          errors.push({ source: item.source, monitor: monitor.query, stage: "notify", item: hotItem.url, message: error.message });
        }
      }
    }

    return {
      ok: true,
      processed,
      notified,
      errors,
      alerts,
      sourceStats,
      freshnessWindowDays: FRESHNESS_WINDOW_DAYS,
      staleCleanup: freshnessPruneResult
    };
  } finally {
    isRunning = false;
  }
}

module.exports = {
  runPipeline,
  listEnabledMonitors
};
