import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BellRing,
  Compass,
  Flame,
  Globe,
  Radar,
  Rss,
  Settings2,
  Sparkles,
  AtSign,
  Zap
} from "lucide-react";
import { Spotlight } from "@/components/ui/spotlight";
import { CardSpotlight } from "@/components/ui/card-spotlight";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "";

const SOURCE_META = {
  twitter: { label: "X / Twitter", icon: AtSign, tone: "twitter" },
  web: { label: "Web", icon: Globe, tone: "web" },
  rss: { label: "RSS", icon: Rss, tone: "rss" }
};

function extractApiErrorMessage(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload.error === "string") return payload.error;
  const fieldErrors = payload.error?.fieldErrors;
  if (fieldErrors && typeof fieldErrors === "object") {
    const firstMessage = Object.values(fieldErrors).flat().find(Boolean);
    if (firstMessage) return String(firstMessage);
  }
  return "";
}

async function api(path, options) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  if (!response.ok) {
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    throw new Error(extractApiErrorMessage(parsed) || text || `HTTP ${response.status}`);
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

function trimText(text, max = 170) {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function formatTime(time) {
  if (!time) return "未知时间";
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function streamTone(state) {
  if (state === "connected") return "connected";
  if (state === "disconnected") return "disconnected";
  return "connecting";
}

function formatConfidence(value) {
  if (value === null || value === undefined || value === "") return "--";
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return num.toFixed(2);
}

function formatSystemAlertStatus(alert) {
  if (!alert) return "";
  if (alert.code === "TWITTER_CREDITS_EXHAUSTED") {
    return "Twitter credits exhausted: twitterapi.io 额度不足，请充值后再试";
  }
  return alert.displayMessage || alert.message || "";
}

function pickPriorityAlert(alerts) {
  if (!Array.isArray(alerts) || alerts.length === 0) return null;
  return alerts.find((alert) => alert?.code === "TWITTER_CREDITS_EXHAUSTED") || alerts[0];
}

function isTrueLike(value) {
  return value === true || value === 1 || value === "1";
}

function tierMeta(tier) {
  if (tier === "high") return { label: "高", className: "border-rose-300/35 bg-rose-300/10 text-rose-200" };
  if (tier === "medium") return { label: "中", className: "border-amber-300/35 bg-amber-300/10 text-amber-200" };
  return { label: "低", className: "border-zinc-600 bg-zinc-800/70 text-zinc-300" };
}

function trustMeta(level) {
  if (level === "high") return { label: "可信高", className: "border-emerald-300/35 bg-emerald-300/10 text-emerald-200" };
  if (level === "medium") return { label: "可信中", className: "border-sky-300/35 bg-sky-300/10 text-sky-200" };
  return { label: "可信低", className: "border-zinc-600 bg-zinc-800/70 text-zinc-300" };
}

function resolveHotLevel(item) {
  if (!item) return "low";
  if (item.source === "twitter") return item.engagement_tier || "low";
  return item.signal_tier || "low";
}

function hotLevelMeta(level) {
  if (level === "high") {
    return {
      label: "热点高",
      note: "建议立即跟进",
      icon: Flame,
      cardClass: "border-rose-300/40 bg-[linear-gradient(180deg,rgba(251,113,133,0.16)_0%,rgba(24,24,27,0.8)_70%)] shadow-[0_10px_28px_rgba(244,63,94,0.18)]",
      chipClass: "border-rose-300/40 bg-rose-300/12 text-rose-200"
    };
  }
  if (level === "medium") {
    return {
      label: "热点中",
      note: "可择机跟进",
      icon: Radar,
      cardClass: "border-amber-300/35 bg-[linear-gradient(180deg,rgba(251,191,36,0.12)_0%,rgba(24,24,27,0.78)_72%)]",
      chipClass: "border-amber-300/35 bg-amber-300/10 text-amber-200"
    };
  }
  return {
    label: "热点低",
    note: "持续观察即可",
    icon: Sparkles,
    cardClass: "border-zinc-700 bg-zinc-900/70",
    chipClass: "border-zinc-600 bg-zinc-800/80 text-zinc-300"
  };
}

function App() {
  const [monitors, setMonitors] = useState([]);
  const [hotItems, setHotItems] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ type: "keyword", query: "" });
  const [status, setStatus] = useState("就绪");
  const [loading, setLoading] = useState(false);
  const [streamState, setStreamState] = useState("connecting");
  const [activeTab, setActiveTab] = useState("monitors");

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
    document.documentElement.classList.add("dark");
    return () => document.documentElement.classList.remove("dark");
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
          setStatus("捕捉到新热点，热点流已实时更新");
        }
        if (msg.type === "notification") {
          setNotifications((prev) => dedupeById([msg.data, ...prev]).slice(0, 120));
          setStatus("命中可推送内容，通知流已实时更新");
        }
        if (msg.type === "system_alert") {
          const nextStatus = formatSystemAlertStatus(msg.data);
          if (nextStatus) {
            setStatus(nextStatus);
          }
        }
      } catch {
        // ignore malformed event payload
      }
    };

    return () => es.close();
  }, []);

  const sortedMonitors = useMemo(() => monitors.slice().sort((a, b) => b.id - a.id), [monitors]);
  const activeMonitorCount = useMemo(() => monitors.filter((m) => m.enabled).length, [monitors]);
  const tabs = useMemo(
    () => [
      { id: "monitors", label: "监控规则", icon: Compass, count: sortedMonitors.length },
      { id: "settings", label: "系统参数", icon: Settings2, count: null },
      { id: "hotItems", label: "最新热点", icon: Flame, count: hotItems.length },
      { id: "notifications", label: "通知流水", icon: BellRing, count: notifications.length }
    ],
    [hotItems.length, notifications.length, sortedMonitors.length]
  );

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
      setStatus("监控规则已新增");
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
        body: JSON.stringify({ enabled: !monitor.enabled })
      });
      await loadAll();
      setStatus(`规则 ${monitor.enabled ? "已停用" : "已启用"}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function runNow(source) {
    setLoading(true);
    setStatus(`正在执行${source ? ` ${SOURCE_META[source]?.label || source}` : "全源"}扫描...`);
    try {
      const result = await api("/api/run-now", {
        method: "POST",
        body: JSON.stringify(source ? { source } : {})
      });
      const priorityAlert = pickPriorityAlert(result.alerts);
      if (priorityAlert) {
        setStatus(formatSystemAlertStatus(priorityAlert));
      } else if (Array.isArray(result.errors) && result.errors.length > 0) {
        setStatus(`扫描完成，但有 ${result.errors.length} 个采集错误`);
      } else {
        setStatus(`扫描完成：处理 ${result.processed || 0} 条，命中通知 ${result.notified || 0} 条`);
      }
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
        twitterQuality: {
          notifyMinEngagementScore: Number(settings.twitterQuality?.notifyMinEngagementScore ?? 2000)
        },
        notification: {
          feishuWebhook: settings.notification.feishuWebhook.trim(),
          feishuKeyword: settings.notification.feishuKeyword
        },
        limits: {
          perSource: Number(settings.limits.perSource)
        },
        nonTwitterSignal: {
          highThreshold: Number(settings.nonTwitterSignal.highThreshold)
        }
      };
      const saved = await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
      setSettings(saved);
      setStatus("系统参数已保存，调度器已刷新");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#030507_0%,#060b10_52%,#05080f_100%)] text-zinc-100">
      <Spotlight className="-top-44 left-0 md:-top-32 md:left-20" fill="#2dd4bf" />
      <Spotlight className="top-16 left-[42%] h-[140%] w-[110%] opacity-45" fill="#38bdf8" />

      <div className="relative mx-auto w-full max-w-7xl px-4 pb-10 pt-7 sm:px-6 lg:px-8">
        <header className="relative overflow-hidden rounded-3xl border border-zinc-800/80 bg-zinc-950/75 p-6 shadow-[0_20px_90px_rgba(0,0,0,0.45)] backdrop-blur-md sm:p-8">
          <div className="absolute -right-24 -top-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="absolute -bottom-28 left-16 h-52 w-52 rounded-full bg-orange-300/10 blur-3xl" />

          <div className="relative grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-end">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium tracking-[0.16em] text-cyan-200 uppercase">
                <Sparkles className="h-3.5 w-3.5" />
                ypTrend Creator Console
              </p>
              <h1 className="mt-4 text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-5xl">
                抢先发现 AI 热点，
                <span className="bg-gradient-to-r from-cyan-300 via-sky-300 to-teal-200 bg-clip-text text-transparent">第一时间输出高价值内容</span>
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-relaxed text-zinc-300 sm:text-base">
                你专注表达，我们专注雷达：多源采集、AI 研判、实时推送，帮你在热点刚冒头时就完成筛选与判断。
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/70 p-3">
                <p className="text-zinc-400">监控规则</p>
                <p className="mt-1 text-xl font-semibold text-white">{monitors.length}</p>
              </div>
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/70 p-3">
                <p className="text-zinc-400">启用中</p>
                <p className="mt-1 text-xl font-semibold text-emerald-300">{activeMonitorCount}</p>
              </div>
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/70 p-3">
                <p className="text-zinc-400">热点池</p>
                <p className="mt-1 text-xl font-semibold text-sky-300">{hotItems.length}</p>
              </div>
            </div>
          </div>

          <div className="relative mt-6 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => runNow()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-300 px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Radar className="h-4 w-4" />
              全源极速扫描
            </button>
            <button
              type="button"
              onClick={() => runNow("twitter")}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-cyan-300/40 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AtSign className="h-4 w-4" />
              扫 X
            </button>
            <button
              type="button"
              onClick={() => runNow("web")}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-cyan-300/40 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Globe className="h-4 w-4" />
              扫 Web
            </button>
            <button
              type="button"
              onClick={() => runNow("rss")}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-cyan-300/40 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Rss className="h-4 w-4" />
              扫 RSS
            </button>
          </div>

          <div className="relative mt-5 grid gap-2 rounded-2xl border border-zinc-800/80 bg-zinc-900/70 p-4 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
            <p className="truncate text-zinc-200">{status}</p>
            <p className={`stream-badge ${streamTone(streamState)}`}>
              <span className="status-indicator" aria-hidden="true" />
              实时推送：{streamState}
            </p>
          </div>
        </header>

        <section className="mt-7 rounded-3xl border border-zinc-800/70 bg-zinc-950/72 p-2 shadow-[0_10px_40px_rgba(0,0,0,0.28)] backdrop-blur-md sm:p-3">
          <div role="tablist" aria-label="监控台板块标签" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`panel-${tab.id}`}
                  id={`tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm font-medium transition sm:px-4 ${
                    isActive
                      ? "border-cyan-300/45 bg-cyan-300/12 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.14)]"
                      : "border-zinc-800/90 bg-zinc-900/70 text-zinc-300 hover:border-cyan-300/35 hover:text-cyan-200"
                  }`}
                >
                  <span className="inline-flex items-center gap-2 truncate">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{tab.label}</span>
                  </span>
                  {tab.count !== null && (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        isActive ? "border-cyan-200/45 text-cyan-100" : "border-zinc-700 text-zinc-400"
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <main className="mt-4 space-y-6">
          <section className={activeTab === "monitors" || activeTab === "settings" ? "space-y-6" : "hidden"}>
            <CardSpotlight
              id="panel-monitors"
              role="tabpanel"
              aria-labelledby="tab-monitors"
              hidden={activeTab !== "monitors"}
              className={`${activeTab === "monitors" ? "block" : "hidden"} overflow-hidden rounded-3xl border-zinc-800/70 bg-zinc-950/72 p-0`}
            >
              <div className="relative z-10 p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-white">
                    <Compass className="h-4.5 w-4.5 text-cyan-200" />
                    监控规则
                  </h2>
                  <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300">{sortedMonitors.length} 条</span>
                </div>

                <form onSubmit={createMonitor} className="grid gap-2.5 sm:grid-cols-[130px_1fr_auto]">
                  <select
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                    className="h-11 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200 outline-none transition focus:border-cyan-300/50"
                  >
                    <option value="keyword">关键词监控</option>
                    <option value="scope">范围发现</option>
                  </select>
                  <input
                    value={form.query}
                    onChange={(e) => setForm((f) => ({ ...f, query: e.target.value }))}
                    placeholder="例如：OpenAI 发布 / AI coding"
                    className="h-11 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-cyan-300/50"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="h-11 rounded-xl border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    新增
                  </button>
                </form>

                <ul className="panel-scroll mt-4 grid max-h-[330px] gap-2 overflow-auto pr-1">
                  {sortedMonitors.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-100">{m.query}</p>
                        <p className="mt-0.5 text-xs text-zinc-400">{m.type === "keyword" ? "关键词" : "范围"}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleMonitor(m)}
                        disabled={loading}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          m.enabled
                            ? "border border-emerald-300/35 bg-emerald-300/15 text-emerald-200 hover:bg-emerald-300/20"
                            : "border border-amber-300/35 bg-amber-300/10 text-amber-200 hover:bg-amber-300/15"
                        }`}
                      >
                        {m.enabled ? "启用中" : "已停用"}
                      </button>
                    </li>
                  ))}
                  {sortedMonitors.length === 0 && (
                    <li className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 px-3 py-6 text-center text-sm text-zinc-400">
                      还没有监控规则，先添加一个你最想追的关键词。
                    </li>
                  )}
                </ul>
              </div>
            </CardSpotlight>

            <CardSpotlight
              id="panel-settings"
              role="tabpanel"
              aria-labelledby="tab-settings"
              hidden={activeTab !== "settings"}
              className={`${activeTab === "settings" ? "block" : "hidden"} overflow-hidden rounded-3xl border-zinc-800/70 bg-zinc-950/72 p-0`}
            >
              <div className="relative z-10 p-5 sm:p-6">
                <h2 className="mb-4 inline-flex items-center gap-2 text-lg font-semibold text-white">
                  <Settings2 className="h-4.5 w-4.5 text-cyan-200" />
                  系统参数
                </h2>

                {settings && (
                  <form onSubmit={saveSettings} className="grid gap-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1.5 text-xs text-zinc-400">
                        X 采集频率（分钟）
                        <input
                          type="number"
                          min="1"
                          value={settings.intervals.twitterMinutes}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              intervals: { ...s.intervals, twitterMinutes: e.target.value }
                            }))
                          }
                          className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/50"
                        />
                      </label>

                      <label className="grid gap-1.5 text-xs text-zinc-400">
                        Web 采集频率（分钟）
                        <input
                          type="number"
                          min="1"
                          value={settings.intervals.webMinutes}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              intervals: { ...s.intervals, webMinutes: e.target.value }
                            }))
                          }
                          className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/50"
                        />
                      </label>

                      <label className="grid gap-1.5 text-xs text-zinc-400">
                        RSS 采集频率（分钟）
                        <input
                          type="number"
                          min="1"
                          value={settings.intervals.rssMinutes}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              intervals: { ...s.intervals, rssMinutes: e.target.value }
                            }))
                          }
                          className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/50"
                        />
                      </label>

                      <label className="grid gap-1.5 text-xs text-zinc-400">
                        每源条数上限
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={settings.limits.perSource}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              limits: { ...s.limits, perSource: e.target.value }
                            }))
                          }
                          className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/50"
                        />
                      </label>

                      <label className="grid gap-1.5 text-xs text-zinc-400">
                        X 推送阈值（互动分）
                        <input
                          type="number"
                          min="0"
                          value={settings.twitterQuality?.notifyMinEngagementScore ?? 2000}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              twitterQuality: {
                                ...(s.twitterQuality || {}),
                                notifyMinEngagementScore: e.target.value
                              }
                            }))
                          }
                          className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/50"
                        />
                      </label>

                      <label className="grid gap-1.5 text-xs text-zinc-400">
                        Web/RSS 高信号阈值
                        <input
                          type="number"
                          min="50"
                          max="100"
                          value={settings.nonTwitterSignal?.highThreshold ?? 70}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              nonTwitterSignal: {
                                ...(s.nonTwitterSignal || {}),
                                highThreshold: e.target.value
                              }
                            }))
                          }
                          className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/50"
                        />
                      </label>
                    </div>

                    <label className="grid gap-1.5 text-xs text-zinc-400">
                      飞书关键词第一行
                      <input
                        value={settings.notification.feishuKeyword}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            notification: { ...s.notification, feishuKeyword: e.target.value }
                          }))
                        }
                        className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/50"
                      />
                    </label>

                    <label className="grid gap-1.5 text-xs text-zinc-400">
                      飞书 Webhook
                      <input
                        value={settings.notification.feishuWebhook}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            notification: { ...s.notification, feishuWebhook: e.target.value }
                          }))
                        }
                        className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/50"
                      />
                    </label>

                    <button
                      type="submit"
                      disabled={loading}
                      className="mt-1 inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-sm font-medium text-zinc-100 transition hover:border-cyan-300/40 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Settings2 className="h-4 w-4" />
                      保存配置
                    </button>
                  </form>
                )}
              </div>
            </CardSpotlight>
          </section>

          <section className={activeTab === "hotItems" || activeTab === "notifications" ? "space-y-6" : "hidden"}>
            <CardSpotlight
              id="panel-hotItems"
              role="tabpanel"
              aria-labelledby="tab-hotItems"
              hidden={activeTab !== "hotItems"}
              className={`${activeTab === "hotItems" ? "block" : "hidden"} overflow-hidden rounded-3xl border-zinc-800/70 bg-zinc-950/72 p-0`}
            >
              <div className="relative z-10 p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-white">
                    <Flame className="h-4.5 w-4.5 text-orange-200" />
                    最新热点
                  </h2>
                  <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300">{hotItems.length} 条</span>
                </div>

                <ul className="panel-scroll grid max-h-[820px] gap-2.5 overflow-auto pr-1">
                  {hotItems.map((item) => {
                    const meta = SOURCE_META[item.source] || { label: item.source || "unknown", icon: Activity, tone: "web" };
                    const SourceIcon = meta.icon;
                    const level = resolveHotLevel(item);
                    const levelMeta = hotLevelMeta(level);
                    const LevelIcon = levelMeta.icon;
                    return (
                      <li key={item.id} className={`rounded-xl border p-3 transition ${levelMeta.cardClass}`}>
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <span className={`source-chip ${meta.tone}`}>
                            <SourceIcon className="h-3.5 w-3.5" />
                            {meta.label}
                          </span>
                          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${levelMeta.chipClass}`}>
                            <LevelIcon className="h-3.5 w-3.5" />
                            {levelMeta.label}
                          </span>
                          <span className="text-xs text-zinc-500">{formatTime(item.published_at || item.created_at)}</span>
                        </div>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium leading-6 text-zinc-100 transition hover:text-cyan-200"
                        >
                          {item.title}
                        </a>
                        <p className="mt-1.5 text-xs leading-5 text-zinc-400">{trimText(item.summary || "暂无摘要")}</p>
                        <p className="mt-2 text-[11px] text-zinc-500">{levelMeta.note}</p>
                      </li>
                    );
                  })}
                  {hotItems.length === 0 && (
                    <li className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 px-3 py-8 text-center text-sm text-zinc-400">
                      暂无热点，点击“全源极速扫描”开始捕捉第一波趋势。
                    </li>
                  )}
                </ul>
              </div>
            </CardSpotlight>

            <CardSpotlight
              id="panel-notifications"
              role="tabpanel"
              aria-labelledby="tab-notifications"
              hidden={activeTab !== "notifications"}
              className={`${activeTab === "notifications" ? "block" : "hidden"} overflow-hidden rounded-3xl border-zinc-800/70 bg-zinc-950/72 p-0`}
            >
              <div className="relative z-10 p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-white">
                    <BellRing className="h-4.5 w-4.5 text-cyan-200" />
                    通知流水
                  </h2>
                  <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300">{notifications.length} 条</span>
                </div>

                <ul className="panel-scroll grid max-h-[760px] gap-2.5 overflow-auto pr-1">
                  {notifications.map((n) => {
                    const sourceMeta = SOURCE_META[n.source] || { label: n.source || "unknown", icon: Activity, tone: "web" };
                    const SourceIcon = sourceMeta.icon;
                    const isCredible = isTrueLike(n.ai_is_credible);
                    const isRelevant = isTrueLike(n.ai_is_relevant);
                    const trust = trustMeta(n.trust_level);
                    const tier =
                      n.source === "twitter"
                        ? tierMeta(n.engagement_tier)
                        : tierMeta(n.signal_tier);

                    return (
                      <li key={n.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                          <span className={`notify-dot ${n.status || "skipped"}`} />
                          <strong className="text-zinc-200">{n.monitor_query || "未命名规则"}</strong>
                          <span className="rounded-md border border-zinc-700 px-2 py-0.5 text-zinc-400">{n.status || "unknown"}</span>
                          <span className="text-zinc-500">{formatTime(n.sent_at || n.created_at)}</span>
                        </div>

                        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                          <span className={`source-chip ${sourceMeta.tone}`}>
                            <SourceIcon className="h-3.5 w-3.5" />
                            {sourceMeta.label}
                          </span>
                          <span className={`rounded-md border px-2 py-0.5 font-semibold ${trust.className}`}>
                            {trust.label}
                          </span>
                          <span className={`rounded-md border px-2 py-0.5 font-semibold ${tier.className}`}>
                            {n.source === "twitter" ? `互动${tier.label}` : `信号${tier.label}`}
                          </span>
                          <span
                            className={`rounded-md border px-2 py-0.5 font-semibold ${
                              isCredible
                                ? "border-emerald-300/35 bg-emerald-300/10 text-emerald-200"
                                : "border-rose-300/35 bg-rose-300/10 text-rose-200"
                            }`}
                          >
                            可信: {isCredible ? "是" : "否"}
                          </span>
                          <span
                            className={`rounded-md border px-2 py-0.5 font-semibold ${
                              isRelevant
                                ? "border-sky-300/35 bg-sky-300/10 text-sky-200"
                                : "border-zinc-600 bg-zinc-800/70 text-zinc-300"
                            }`}
                          >
                            相关: {isRelevant ? "是" : "否"}
                          </span>
                          <span className="rounded-md border border-zinc-700 px-2 py-0.5 text-zinc-300">
                            置信度 {formatConfidence(n.ai_confidence)}
                          </span>
                        </div>

                        <a
                          href={n.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm text-zinc-100 transition hover:text-cyan-200"
                        >
                          {n.title}
                          <Zap className="h-3.5 w-3.5" />
                        </a>

                        <p className="mt-1.5 text-xs leading-5 text-zinc-400">
                          AI 结论: {trimText(n.ai_reason || "暂无结论")}
                        </p>
                      </li>
                    );
                  })}
                  {notifications.length === 0 && (
                    <li className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 px-3 py-8 text-center text-sm text-zinc-400">
                      通知流为空，系统命中高价值热点后会在这里第一时间出现。
                    </li>
                  )}
                </ul>
              </div>
            </CardSpotlight>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
