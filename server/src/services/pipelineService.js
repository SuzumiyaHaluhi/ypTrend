const { db } = require("../db");
const { normalizeUrl, stableHash, nowIso } = require("../utils/common");
const { fetchFromTwitter } = require("./sources/twitterSource");
const { fetchFromWebSearch } = require("./sources/webSearchSource");
const { fetchFromRss } = require("./sources/rssSource");
const { evaluateItem } = require("./openRouterService");
const { sendFeishuNotification } = require("./feishuService");
const { getSettings } = require("./settingsService");
const { eventBus } = require("./eventBus");

let isRunning = false;

function listEnabledMonitors() {
  return db.prepare("SELECT * FROM monitors WHERE enabled = 1 ORDER BY id DESC").all();
}

function upsertHotItem(item) {
  const url = normalizeUrl(item.url);
  const uniqueHash = stableHash(`${item.source}|${url}|${(item.title || "").slice(0, 120)}`);

  const result = db.prepare(`
    INSERT OR IGNORE INTO hot_items
    (source, source_id, title, url, summary, published_at, unique_hash, discovered_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.source,
    item.sourceId || null,
    item.title,
    url,
    item.summary || null,
    item.publishedAt || null,
    uniqueHash,
    nowIso(),
    JSON.stringify(item.raw || {})
  );

  const row = db.prepare("SELECT * FROM hot_items WHERE unique_hash = ?").get(uniqueHash);
  return { row, isNew: result.changes > 0 };
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
    SELECT n.*, h.title, h.url, m.query AS monitor_query
    FROM notifications n
    JOIN hot_items h ON h.id = n.hot_item_id
    JOIN monitors m ON m.id = n.monitor_id
    WHERE n.hot_item_id = ? AND n.monitor_id = ? AND n.channel = 'feishu'
    LIMIT 1
  `).get(hotItemId, monitorId);
}

function hasNotified(hotItemId, monitorId) {
  const row = db.prepare("SELECT id FROM notifications WHERE hot_item_id = ? AND monitor_id = ? AND channel = 'feishu'").get(hotItemId, monitorId);
  return Boolean(row);
}

async function collectBySource(source, query, limit) {
  if (source === "twitter") return fetchFromTwitter(query, limit);
  if (source === "web") return fetchFromWebSearch(query, limit);
  if (source === "rss") return fetchFromRss(query, limit);
  return [];
}

async function runPipeline({ source } = {}) {
  if (isRunning) {
    return { ok: false, message: "Pipeline is already running" };
  }

  isRunning = true;
  try {
    const settings = getSettings();
    const monitors = listEnabledMonitors();

    if (!monitors.length) {
      return { ok: true, message: "No enabled monitors", processed: 0, notified: 0, errors: [] };
    }

    const sources = source ? [source] : ["twitter", "web", "rss"];
    let processed = 0;
    let notified = 0;
    const errors = [];

    for (const monitor of monitors) {
      for (const src of sources) {
        let collected = [];
        try {
          collected = await collectBySource(src, monitor.query, settings.limits.perSource);
        } catch (error) {
          errors.push({ source: src, monitor: monitor.query, stage: "collect", message: error.message });
          continue;
        }

        for (const item of collected) {
          const { row: hotItem, isNew } = upsertHotItem(item);
          if (isNew) {
            eventBus.emit("realtime-event", { type: "hot_item", data: hotItem });
          }

          processed += 1;
          let evalResult;

          try {
            evalResult = await evaluateItem({ monitor, item: hotItem });
            saveEvaluation({ hotItemId: hotItem.id, monitorId: monitor.id, evalResult });
          } catch (error) {
            errors.push({ source: src, monitor: monitor.query, stage: "evaluate", item: hotItem.url, message: error.message });
            continue;
          }

          if (!evalResult.shouldNotify || !evalResult.isRelevant || !evalResult.isCredible) {
            continue;
          }
          if (hasNotified(hotItem.id, monitor.id)) {
            continue;
          }

          try {
            const sendResult = await sendFeishuNotification({
              webhook: settings.notification.feishuWebhook,
              keyword: settings.notification.feishuKeyword,
              monitor,
              item: hotItem,
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
            }
          } catch (error) {
            errors.push({ source: src, monitor: monitor.query, stage: "notify", item: hotItem.url, message: error.message });
          }
        }
      }
    }

    return { ok: true, processed, notified, errors };
  } finally {
    isRunning = false;
  }
}

module.exports = {
  runPipeline,
  listEnabledMonitors
};
