import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "";

async function api(path, options) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function dedupeById(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function App() {
  const [monitors, setMonitors] = useState([]);
  const [hotItems, setHotItems] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ type: "keyword", query: "" });
  const [status, setStatus] = useState("Ready");
  const [loading, setLoading] = useState(false);
  const [streamState, setStreamState] = useState("connecting");

  const loadAll = useCallback(async () => {
    const [m, h, n, s] = await Promise.all([
      api("/api/keywords"),
      api("/api/hot-items?limit=60"),
      api("/api/notifications?limit=60"),
      api("/api/settings")
    ]);
    setMonitors(m);
    setHotItems(h);
    setNotifications(n);
    setSettings(s);
  }, []);

  useEffect(() => {
    loadAll().catch((error) => setStatus(error.message));
  }, [loadAll]);

  useEffect(() => {
    const streamUrl = `${API_BASE}/api/stream`;
    const es = new EventSource(streamUrl);

    es.onopen = () => setStreamState("connected");
    es.onerror = () => setStreamState("disconnected");

    es.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "hot_item") {
          setHotItems((prev) => dedupeById([msg.data, ...prev]).slice(0, 120));
          setStatus("发现新热点，已实时更新");
        }
        if (msg.type === "notification") {
          setNotifications((prev) => dedupeById([msg.data, ...prev]).slice(0, 120));
          setStatus("发现可通知热点，通知流已实时更新");
        }
      } catch {
        // ignore malformed event payload
      }
    };

    return () => es.close();
  }, []);

  const sortedMonitors = useMemo(() => monitors.slice().sort((a, b) => b.id - a.id), [monitors]);

  async function createMonitor(event) {
    event.preventDefault();
    if (!form.query.trim()) return;
    setLoading(true);
    try {
      await api("/api/keywords", {
        method: "POST",
        body: JSON.stringify({ ...form, query: form.query.trim() })
      });
      setForm((prev) => ({ ...prev, query: "" }));
      await loadAll();
      setStatus("Monitor created");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleMonitor(monitor) {
    setLoading(true);
    try {
      await api(`/api/keywords/${monitor.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !Boolean(monitor.enabled) })
      });
      await loadAll();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function runNow(source) {
    setLoading(true);
    setStatus(`Running pipeline${source ? ` (${source})` : ""}...`);
    try {
      const result = await api("/api/run-now", {
        method: "POST",
        body: JSON.stringify(source ? { source } : {})
      });
      setStatus(`Done: processed ${result.processed || 0}, notified ${result.notified || 0}`);
      await loadAll();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!settings) return;
    setLoading(true);
    try {
      const payload = {
        intervals: {
          twitterMinutes: Number(settings.intervals.twitterMinutes),
          webMinutes: Number(settings.intervals.webMinutes),
          rssMinutes: Number(settings.intervals.rssMinutes)
        },
        notification: {
          feishuWebhook: settings.notification.feishuWebhook,
          feishuKeyword: settings.notification.feishuKeyword
        },
        limits: {
          perSource: Number(settings.limits.perSource)
        }
      };
      const saved = await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
      setSettings(saved);
      setStatus("Settings saved and scheduler reloaded");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="hero">
        <p className="kicker">ypTrend</p>
        <h1>实时热点雷达</h1>
        <p className="subtitle">多源采集 + AI 去伪 + 飞书秒级通知，盯住 AI 大模型与 AI 编程变化。</p>
        <div className="run-actions">
          <button onClick={() => runNow()} disabled={loading}>立即全源扫描</button>
          <button onClick={() => runNow("twitter")} disabled={loading}>扫 X</button>
          <button onClick={() => runNow("web")} disabled={loading}>扫网页</button>
          <button onClick={() => runNow("rss")} disabled={loading}>扫 RSS</button>
        </div>
        <p className="status">{status}</p>
        <p className={`stream ${streamState}`}>实时推送: {streamState}</p>
      </header>

      <main className="layout">
        <section className="panel">
          <h2>监控规则</h2>
          <form onSubmit={createMonitor} className="monitor-form">
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="keyword">关键词监控</option>
              <option value="scope">范围发现</option>
            </select>
            <input
              value={form.query}
              onChange={(e) => setForm((f) => ({ ...f, query: e.target.value }))}
              placeholder="例如：GPT-5 update / AI coding"
            />
            <button type="submit" disabled={loading}>新增</button>
          </form>
          <ul className="monitor-list">
            {sortedMonitors.map((m) => (
              <li key={m.id}>
                <div>
                  <strong>{m.query}</strong>
                  <span>{m.type}</span>
                </div>
                <button className={m.enabled ? "on" : "off"} onClick={() => toggleMonitor(m)}>
                  {m.enabled ? "启用中" : "已停用"}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>系统参数</h2>
          {settings && (
            <form onSubmit={saveSettings} className="settings-form">
              <label>
                X 采集频率（分钟）
                <input type="number" min="1" value={settings.intervals.twitterMinutes}
                  onChange={(e) => setSettings((s) => ({ ...s, intervals: { ...s.intervals, twitterMinutes: e.target.value } }))} />
              </label>
              <label>
                网页采集频率（分钟）
                <input type="number" min="1" value={settings.intervals.webMinutes}
                  onChange={(e) => setSettings((s) => ({ ...s, intervals: { ...s.intervals, webMinutes: e.target.value } }))} />
              </label>
              <label>
                RSS 采集频率（分钟）
                <input type="number" min="1" value={settings.intervals.rssMinutes}
                  onChange={(e) => setSettings((s) => ({ ...s, intervals: { ...s.intervals, rssMinutes: e.target.value } }))} />
              </label>
              <label>
                每源条数上限
                <input type="number" min="1" max="30" value={settings.limits.perSource}
                  onChange={(e) => setSettings((s) => ({ ...s, limits: { ...s.limits, perSource: e.target.value } }))} />
              </label>
              <label>
                飞书关键词第一行
                <input value={settings.notification.feishuKeyword}
                  onChange={(e) => setSettings((s) => ({ ...s, notification: { ...s.notification, feishuKeyword: e.target.value } }))} />
              </label>
              <label>
                飞书 Webhook
                <input value={settings.notification.feishuWebhook}
                  onChange={(e) => setSettings((s) => ({ ...s, notification: { ...s.notification, feishuWebhook: e.target.value } }))} />
              </label>
              <button type="submit" disabled={loading}>保存配置</button>
            </form>
          )}
        </section>

        <section className="panel feed">
          <h2>最新热点</h2>
          <ul>
            {hotItems.map((item) => (
              <li key={item.id}>
                <div className="row">
                  <span className={`source ${item.source}`}>{item.source}</span>
                  <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                </div>
                <p>{item.summary}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel feed">
          <h2>通知流水</h2>
          <ul>
            {notifications.map((n) => (
              <li key={n.id}>
                <div className="row">
                  <span className={`status-dot ${n.status}`}></span>
                  <strong>{n.monitor_query}</strong>
                  <span>{n.status}</span>
                </div>
                <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

export default App;
