const express = require("express");
const cors = require("cors");
const { db } = require("./db");
const { nowIso } = require("./utils/common");
const { runPipeline } = require("./services/pipelineService");
const { getSettings, updateSettings } = require("./services/settingsService");
const { createMonitorSchema, updateMonitorSchema, updateSettingsSchema } = require("./routes/schemas");
const { eventBus } = require("./services/eventBus");
const { filterFreshHotItems, filterFreshNotifications, pruneStaleRecords } = require("./services/freshnessService");

function createApp({ scheduler }) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const sseClients = new Set();

  function pushSse(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  }

  eventBus.on("realtime-event", pushSse);

  app.get("/api/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    sseClients.add(res);
    res.write(`data: ${JSON.stringify({ type: "connected", ts: nowIso() })}\n\n`);

    const keepAlive = setInterval(() => {
      res.write(`: keepalive ${Date.now()}\n\n`);
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  app.get("/api/health", (_, res) => {
    res.json({ ok: true, time: nowIso() });
  });

  app.get("/api/keywords", (_, res) => {
    const rows = db.prepare("SELECT * FROM monitors ORDER BY id DESC").all();
    res.json(rows);
  });

  app.post("/api/keywords", (req, res) => {
    const parsed = createMonitorSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const now = nowIso();
    const { type, query } = parsed.data;
    const result = db.prepare("INSERT INTO monitors (type, query, enabled, created_at, updated_at) VALUES (?, ?, 1, ?, ?)").run(type, query, now, now);
    const row = db.prepare("SELECT * FROM monitors WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(row);
  });

  app.patch("/api/keywords/:id", (req, res) => {
    const id = Number(req.params.id);
    const parsed = updateMonitorSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const current = db.prepare("SELECT * FROM monitors WHERE id = ?").get(id);
    if (!current) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    const next = { ...current, ...parsed.data, updated_at: nowIso() };
    db.prepare("UPDATE monitors SET type = ?, query = ?, enabled = ?, updated_at = ? WHERE id = ?")
      .run(next.type, next.query, next.enabled ? 1 : 0, next.updated_at, id);

    const row = db.prepare("SELECT * FROM monitors WHERE id = ?").get(id);
    res.json(row);
  });

  app.delete("/api/keywords/:id", (req, res) => {
    const id = Number(req.params.id);
    db.prepare("DELETE FROM monitors WHERE id = ?").run(id);
    res.status(204).send();
  });

  app.get("/api/hot-items", (req, res) => {
    pruneStaleRecords();
    const limit = Number(req.query.limit || 100);
    const rows = db.prepare("SELECT * FROM hot_items ORDER BY id DESC").all();
    res.json(filterFreshHotItems(rows).slice(0, limit));
  });

  app.get("/api/notifications", (req, res) => {
    pruneStaleRecords();
    const limit = Number(req.query.limit || 100);
    const rows = db.prepare(`
      SELECT
        n.*,
        h.source,
        h.title,
        h.url,
        h.published_at AS hot_published_at,
        h.discovered_at AS hot_discovered_at,
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
      ORDER BY n.id DESC
    `).all();
    const filtered = filterFreshNotifications(rows)
      .slice(0, limit)
      .map(({ hot_published_at, hot_discovered_at, ...rest }) => rest);
    res.json(filtered);
  });

  app.get("/api/settings", (_, res) => {
    res.json(getSettings());
  });

  app.put("/api/settings", (req, res) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const next = updateSettings(parsed.data);
    scheduler.reload();
    res.json(next);
  });

  app.post("/api/run-now", async (req, res) => {
    try {
      const source = req.body?.source;
      const result = await runPipeline({ source });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return app;
}

module.exports = { createApp };
