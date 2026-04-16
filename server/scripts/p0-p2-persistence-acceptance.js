const path = require("path");
const fs = require("fs");
const axios = require("axios");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs, intervalMs = 400) {
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

function randomPort() {
  return 19000 + Math.floor(Math.random() * 1000);
}

function clearServerModuleCache(serverSrcDir) {
  const prefix = `${serverSrcDir}${path.sep}`;
  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.startsWith(prefix)) {
      delete require.cache[modulePath];
    }
  }
}

async function startServer({ port, dbFile, allowMemoryFallback, journalMode, serverDir }) {
  process.env.PORT = String(port);
  process.env.DB_FILE = dbFile;
  process.env.DB_ALLOW_MEMORY_FALLBACK = allowMemoryFallback ? "1" : "0";
  process.env.SQLITE_JOURNAL_MODE = journalMode || "MEMORY";
  process.env.NODE_ENV = process.env.NODE_ENV || "development";

  const srcDir = path.join(serverDir, "src");
  clearServerModuleCache(srcDir);

  const { createApp } = require("../src/app");
  const { SchedulerManager } = require("../src/services/schedulerService");
  const { getSettings } = require("../src/services/settingsService");
  const { db } = require("../src/db");

  const scheduler = new SchedulerManager();
  const app = createApp({ scheduler });
  getSettings();
  scheduler.start();

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(port, () => resolve(instance));
    instance.on("error", reject);
  });

  return { server, scheduler, db };
}

async function stopServer(runtime, serverDir) {
  if (!runtime) return;
  runtime.scheduler.stop();
  await new Promise((resolve) => runtime.server.close(() => resolve()));
  try {
    runtime.db.close();
  } catch {
    // noop
  }
  clearServerModuleCache(path.join(serverDir, "src"));
}

async function main() {
  const serverDir = path.resolve(__dirname, "..");
  const dataDir = path.join(serverDir, "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const runId = Date.now();
  const dbFile = path.join(dataDir, `p0_p2_persist_${runId}.db`);
  const monitorQuery = `P0-2 persistence ${runId}`;
  const targetTwitterMinutes = 7;
  const portA = randomPort();
  const portB = randomPort();
  const baseA = `http://127.0.0.1:${portA}`;
  const baseB = `http://127.0.0.1:${portB}`;

  let runtimeA;
  let runtimeB;

  try {
    runtimeA = await startServer({
      port: portA,
      dbFile,
      allowMemoryFallback: false,
      journalMode: "MEMORY",
      serverDir
    });

    await waitFor(async () => {
      const resp = await axios.get(`${baseA}/api/health`, { timeout: 2500, proxy: false });
      if (!resp.data?.ok) throw new Error("Server A health check failed");
      return resp.data;
    }, 20000);

    const createResp = await axios.post(`${baseA}/api/keywords`, {
      type: "keyword",
      query: monitorQuery
    }, { timeout: 8000, proxy: false });

    await axios.put(`${baseA}/api/settings`, {
      intervals: {
        twitterMinutes: targetTwitterMinutes
      }
    }, { timeout: 8000, proxy: false });

    const verifyA = await axios.get(`${baseA}/api/settings`, { timeout: 8000, proxy: false });
    if (Number(verifyA.data?.intervals?.twitterMinutes) !== targetTwitterMinutes) {
      throw new Error("Phase A settings write verification failed");
    }

    await stopServer(runtimeA, serverDir);
    runtimeA = null;

    if (!fs.existsSync(dbFile)) {
      throw new Error(`DB file not found after phase A: ${dbFile}`);
    }
    const dbSize = fs.statSync(dbFile).size;
    if (dbSize <= 0) {
      throw new Error(`DB file size is 0 after phase A: ${dbFile}`);
    }

    runtimeB = await startServer({
      port: portB,
      dbFile,
      allowMemoryFallback: false,
      journalMode: "MEMORY",
      serverDir
    });

    await waitFor(async () => {
      const resp = await axios.get(`${baseB}/api/health`, { timeout: 2500, proxy: false });
      if (!resp.data?.ok) throw new Error("Server B health check failed");
      return resp.data;
    }, 20000);

    const keywordsResp = await axios.get(`${baseB}/api/keywords`, { timeout: 8000, proxy: false });
    const monitors = Array.isArray(keywordsResp.data) ? keywordsResp.data : [];
    const matchedMonitor = monitors.find((m) => m.query === monitorQuery);
    if (!matchedMonitor) {
      throw new Error("Phase B read verification failed: monitor not found");
    }

    const settingsResp = await axios.get(`${baseB}/api/settings`, { timeout: 8000, proxy: false });
    if (Number(settingsResp.data?.intervals?.twitterMinutes) !== targetTwitterMinutes) {
      throw new Error("Phase B read verification failed: persisted settings not found");
    }

    const summary = {
      ok: true,
      dbFile,
      dbSizeBytes: fs.statSync(dbFile).size,
      monitorId: createResp.data?.id,
      monitorQuery,
      persistedTwitterMinutes: Number(settingsResp.data?.intervals?.twitterMinutes),
      phasePorts: { phaseA: portA, phaseB: portB }
    };

    console.log("\n[P0-2] Persistence acceptance passed.");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await stopServer(runtimeA, serverDir);
    await stopServer(runtimeB, serverDir);

    try {
      if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
      if (fs.existsSync(`${dbFile}-journal`)) fs.unlinkSync(`${dbFile}-journal`);
      if (fs.existsSync(`${dbFile}-wal`)) fs.unlinkSync(`${dbFile}-wal`);
      if (fs.existsSync(`${dbFile}-shm`)) fs.unlinkSync(`${dbFile}-shm`);
    } catch {
      // cleanup best effort
    }
  }
}

main().catch((error) => {
  console.error(`\n[P0-2] Persistence acceptance failed: ${error.message}`);
  process.exit(1);
});
