const { db } = require("../db");
const { nowIso } = require("../utils/common");
const { config } = require("../config");

const DEFAULT_SETTINGS = {
  intervals: {
    twitterMinutes: 5,
    webMinutes: 15,
    rssMinutes: 10
  },
  limits: {
    perSource: config.defaultScanLimitPerSource
  },
  notification: {
    feishuWebhook: config.feishuWebhook,
    feishuKeyword: config.feishuKeyword
  }
};

function getSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE id = 1").get();
  if (!row) {
    const now = nowIso();
    db.prepare("INSERT INTO settings (id, value, updated_at) VALUES (1, ?, ?)").run(JSON.stringify(DEFAULT_SETTINGS), now);
    return DEFAULT_SETTINGS;
  }
  try {
    const parsed = JSON.parse(row.value);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      intervals: { ...DEFAULT_SETTINGS.intervals, ...(parsed.intervals || {}) },
      limits: { ...DEFAULT_SETTINGS.limits, ...(parsed.limits || {}) },
      notification: { ...DEFAULT_SETTINGS.notification, ...(parsed.notification || {}) }
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function updateSettings(nextValue) {
  const merged = {
    ...getSettings(),
    ...nextValue,
    intervals: { ...getSettings().intervals, ...(nextValue.intervals || {}) },
    limits: { ...getSettings().limits, ...(nextValue.limits || {}) },
    notification: { ...getSettings().notification, ...(nextValue.notification || {}) }
  };
  db.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE id = 1").run(JSON.stringify(merged), nowIso());
  return merged;
}

module.exports = {
  DEFAULT_SETTINGS,
  getSettings,
  updateSettings
};
