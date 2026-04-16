const http = require("http");
const axios = require("axios");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs, intervalMs = 500) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await sleep(intervalMs);
    }
  }
  throw lastError || new Error("Timeout");
}

function createSseCollector(streamUrl) {
  const events = [];
  const requiredTypes = new Set(["hot_item", "notification"]);
  const matchedTypes = new Set();
  let closed = false;
  let resolveReady;
  let rejectReady;

  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const request = http.get(streamUrl, {
    headers: {
      Accept: "text/event-stream"
    }
  });

  let buffer = "";
  let statusCode = 0;

  request.on("response", (res) => {
    statusCode = res.statusCode || 0;
    if (statusCode !== 200) {
      rejectReady(new Error(`SSE returned status ${statusCode}`));
      return;
    }
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buffer += chunk;
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || "";

      for (const frame of frames) {
        const lines = frame.split(/\r?\n/);
        const dataLines = lines
          .map((line) => line.trimEnd())
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());
        if (!dataLines.length) continue;
        const payloadText = dataLines.join("\n");
        try {
          const payload = JSON.parse(payloadText);
          events.push(payload);
          if (payload && payload.type && requiredTypes.has(payload.type)) {
            matchedTypes.add(payload.type);
          }
        } catch {
          // ignore malformed payloads
        }
      }
    });

    res.on("error", (error) => {
      if (!closed) rejectReady(error);
    });

    resolveReady();
  });

  request.on("error", (error) => {
    if (!closed) rejectReady(error);
  });

  return {
    events,
    get statusCode() {
      return statusCode;
    },
    async ready(timeoutMs = 15000) {
      await Promise.race([
        readyPromise,
        sleep(timeoutMs).then(() => {
          throw new Error("SSE connection timeout");
        })
      ]);
    },
    async waitForRequiredTypes(timeoutMs = 60000) {
      await waitFor(() => {
        if (requiredTypes.size === matchedTypes.size) {
          return true;
        }
        throw new Error(`Waiting SSE events: ${Array.from(requiredTypes).filter((x) => !matchedTypes.has(x)).join(", ")}`);
      }, timeoutMs, 300);
    },
    close() {
      closed = true;
      request.destroy();
    }
  };
}

function uniquePort() {
  const base = 18000;
  const offset = Math.floor(Math.random() * 1000);
  return base + offset;
}

async function main() {
  const port = uniquePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbFile = ":memory:";
  const monitorQuery = `AI coding ${Date.now()}`;
  const runResults = [];
  process.env.PORT = String(port);
  process.env.DB_FILE = dbFile;
  process.env.OPENROUTER_API_KEY = "";
  process.env.NODE_ENV = process.env.NODE_ENV || "development";

  const { createApp } = require("../src/app");
  const { SchedulerManager } = require("../src/services/schedulerService");
  const { getSettings } = require("../src/services/settingsService");

  const scheduler = new SchedulerManager();
  const app = createApp({ scheduler });
  getSettings();
  scheduler.start();

  let server;

  let sse;
  let createdMonitor;

  try {
    await new Promise((resolve, reject) => {
      server = app.listen(port, resolve);
      server.on("error", reject);
    });

    await waitFor(async () => {
      const resp = await axios.get(`${baseUrl}/api/health`, { timeout: 2000, proxy: false });
      if (!resp.data?.ok) {
        throw new Error("Health check returned non-ok");
      }
      return resp.data;
    }, 30000, 500);

    sse = createSseCollector(`${baseUrl}/api/stream`);
    await sse.ready();

    const createResp = await axios.post(`${baseUrl}/api/keywords`, {
      type: "keyword",
      query: monitorQuery
    }, { timeout: 10000, proxy: false });
    createdMonitor = createResp.data;

    const sources = ["web", "rss", "twitter"];
    let processedAny = false;
    for (const source of sources) {
      const runResp = await axios.post(`${baseUrl}/api/run-now`, { source }, {
        timeout: 120000,
        proxy: false
      });
      runResults.push({ source, ...runResp.data });
      if ((runResp.data?.processed || 0) > 0) {
        processedAny = true;
        break;
      }
    }

    if (!processedAny) {
      throw new Error(`No items processed from sources. run-now results: ${JSON.stringify(runResults)}`);
    }

    const hotItems = await waitFor(async () => {
      const resp = await axios.get(`${baseUrl}/api/hot-items?limit=120`, { timeout: 10000, proxy: false });
      if (!Array.isArray(resp.data) || resp.data.length === 0) {
        throw new Error("No hot items in database yet");
      }
      return resp.data;
    }, 30000, 500);

    const notifications = await waitFor(async () => {
      const resp = await axios.get(`${baseUrl}/api/notifications?limit=120`, { timeout: 10000, proxy: false });
      const rows = Array.isArray(resp.data) ? resp.data : [];
      const matched = rows.filter((row) => row.monitor_query === monitorQuery);
      if (!matched.length) {
        throw new Error("No notification rows found for the created monitor yet");
      }
      return matched;
    }, 30000, 500);

    try {
      await sse.waitForRequiredTypes(30000);
    } catch (error) {
      const observed = Array.from(new Set(sse.events.map((x) => x?.type).filter(Boolean)));
      throw new Error(`${error.message}; SSE status=${sse.statusCode}; observed=${observed.join(",") || "none"}`);
    }

    const summary = {
      ok: true,
      port,
      dbFileMode: dbFile,
      monitorId: createdMonitor?.id,
      monitorQuery,
      runResults,
      hotItemsCount: hotItems.length,
      notificationsCount: notifications.length,
      sseEventTypes: Array.from(new Set(sse.events.map((x) => x?.type).filter(Boolean)))
    };

    console.log("\n[P0-1] E2E acceptance passed.");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (sse) sse.close();
    scheduler.stop();
    await new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
  }
}

main().catch((error) => {
  console.error(`\n[P0-1] E2E acceptance failed: ${error.message}`);
  process.exit(1);
});
