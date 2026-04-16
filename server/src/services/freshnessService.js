const { db } = require("../db");
const { config } = require("../config");

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESHNESS_WINDOW_DAYS = Math.max(1, Number(config.freshnessWindowDays) || 7);

function toTimestampMs(value) {
  if (value === undefined || value === null || value === "") return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function resolveReferenceTimestamp(record = {}) {
  return (
    toTimestampMs(record.publishedAt) ??
    toTimestampMs(record.discoveredAt) ??
    toTimestampMs(record.createdAt) ??
    toTimestampMs(record.sentAt)
  );
}

function isStaleRecord(record, { nowMs = Date.now(), windowDays = FRESHNESS_WINDOW_DAYS } = {}) {
  const referenceTs = resolveReferenceTimestamp(record);
  if (referenceTs === null) return false;
  const cutoff = nowMs - (windowDays * DAY_MS);
  return referenceTs < cutoff;
}

function toRecordFromHotItemLike(row = {}) {
  return {
    publishedAt: row.published_at ?? row.hot_published_at ?? row.publishedAt,
    discoveredAt: row.discovered_at ?? row.hot_discovered_at ?? row.discoveredAt,
    createdAt: row.created_at ?? row.createdAt,
    sentAt: row.sent_at ?? row.sentAt
  };
}

function filterFreshHotItems(rows, options) {
  return rows.filter((row) => !isStaleRecord(toRecordFromHotItemLike(row), options));
}

function filterFreshNotifications(rows, options) {
  return rows.filter((row) => !isStaleRecord(toRecordFromHotItemLike(row), options));
}

function pruneStaleRecords(options) {
  const rows = db.prepare("SELECT id, published_at, discovered_at FROM hot_items").all();
  const staleIds = rows
    .filter((row) => isStaleRecord(toRecordFromHotItemLike(row), options))
    .map((row) => row.id);

  if (!staleIds.length) {
    return {
      staleHotItems: 0,
      deletedEvaluations: 0,
      deletedNotifications: 0
    };
  }

  const deleteEvaluationByHotItemId = db.prepare("DELETE FROM ai_evaluations WHERE hot_item_id = ?");
  const deleteNotificationByHotItemId = db.prepare("DELETE FROM notifications WHERE hot_item_id = ?");
  const deleteHotItemById = db.prepare("DELETE FROM hot_items WHERE id = ?");

  const runDelete = db.transaction((ids) => {
    let deletedEvaluations = 0;
    let deletedNotifications = 0;
    let staleHotItems = 0;

    for (const id of ids) {
      deletedEvaluations += deleteEvaluationByHotItemId.run(id).changes;
      deletedNotifications += deleteNotificationByHotItemId.run(id).changes;
      staleHotItems += deleteHotItemById.run(id).changes;
    }

    return { staleHotItems, deletedEvaluations, deletedNotifications };
  });

  return runDelete(staleIds);
}

module.exports = {
  DAY_MS,
  FRESHNESS_WINDOW_DAYS,
  toTimestampMs,
  resolveReferenceTimestamp,
  isStaleRecord,
  filterFreshHotItems,
  filterFreshNotifications,
  pruneStaleRecords
};
