const express = require("express");
const cors = require("cors");
const { db } = require("./db");
const { nowIso } = require("./utils/common");
const { runPipeline } = require("./services/pipelineService");
const { getSettings, updateSettings } = require("./services/settingsService");
const { createMonitorSchema, updateMonitorSchema, updateSettingsSchema } = require("./routes/schemas");
const { eventBus } = require("./services/eventBus");

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
    const limit = Number(req.query.limit || 100);
    const rows = db.prepare("SELECT * FROM hot_items ORDER BY id DESC LIMIT ?").all(limit);
    res.json(rows);
  });

  app.get("/api/notifications", (req, res) => {
    const limit = Number(req.query.limit || 100);
    const rows = db.prepare(`
      SELECT n.*, h.title, h.url, m.query AS monitor_query
      FROM notifications n
      JOIN hot_items h ON h.id = n.hot_item_id
      JOIN monitors m ON m.id = n.monitor_id
      ORDER BY n.id DESC LIMIT ?
    `).all(limit);
    res.json(rows);
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
