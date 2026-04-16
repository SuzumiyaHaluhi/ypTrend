const Database = require("better-sqlite3");
const { config } = require("./config");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('keyword','scope')),
  query TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hot_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_id TEXT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  summary TEXT,
  published_at TEXT,
  unique_hash TEXT NOT NULL UNIQUE,
  discovered_at TEXT NOT NULL,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS ai_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hot_item_id INTEGER NOT NULL,
  monitor_id INTEGER NOT NULL,
  model TEXT,
  is_relevant INTEGER NOT NULL,
  is_credible INTEGER NOT NULL,
  confidence REAL NOT NULL,
  reason TEXT,
  should_notify INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(hot_item_id) REFERENCES hot_items(id),
  FOREIGN KEY(monitor_id) REFERENCES monitors(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hot_item_id INTEGER NOT NULL,
  monitor_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(hot_item_id, monitor_id, channel),
  FOREIGN KEY(hot_item_id) REFERENCES hot_items(id),
  FOREIGN KEY(monitor_id) REFERENCES monitors(id)
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

function applyPragmas(instance, journalMode) {
  const mode = (journalMode || "DELETE").toUpperCase();
  instance.pragma(`journal_mode = ${mode}`);
  if (mode === "MEMORY") {
    instance.pragma("synchronous = NORMAL");
  }
}

function createDb(file, { journalMode } = {}) {
  const instance = new Database(file);
  try {
    applyPragmas(instance, journalMode);
    instance.exec(SCHEMA_SQL);
    return instance;
  } catch (error) {
    try {
      instance.close();
    } catch {
      // noop
    }
    throw error;
  }
}

let db;
let dbInitError;

try {
  db = createDb(config.dbFile, { journalMode: config.sqliteJournalMode });
} catch (error) {
  dbInitError = error;
}

const isDiskIoError = /disk I\/O error/i.test(String(dbInitError?.message || ""));
const shouldRetryWithMemoryJournal =
  !db &&
  isDiskIoError &&
  config.dbFile !== ":memory:" &&
  config.sqliteJournalMode !== "MEMORY";

if (shouldRetryWithMemoryJournal) {
  try {
    console.warn(`[ypTrend] SQLite init failed with journal_mode=${config.sqliteJournalMode} (${dbInitError.message}), retry with journal_mode=MEMORY.`);
    db = createDb(config.dbFile, { journalMode: "MEMORY" });
    dbInitError = null;
  } catch (retryError) {
    dbInitError = retryError;
  }
}

if (!db && dbInitError) {
  if (config.dbAllowMemoryFallback) {
    console.warn(`[ypTrend] Failed to initialize SQLite file DB (${config.dbFile}), fallback to in-memory DB: ${dbInitError.message}`);
    db = createDb(":memory:", { journalMode: "MEMORY" });
  } else {
    throw new Error(`[ypTrend] Failed to initialize SQLite file DB (${config.dbFile}) and memory fallback is disabled: ${dbInitError.message}`);
  }
}

module.exports = { db };
