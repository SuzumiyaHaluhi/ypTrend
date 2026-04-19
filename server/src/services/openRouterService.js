const axios = require("axios");
const { config } = require("../config");

let cachedModel = null;
let cachedAt = 0;
let lastRequestAt = 0;

function parseNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : Number.POSITIVE_INFINITY;
}

async function selectModel() {
  const now = Date.now();
  if (cachedModel && now - cachedAt < 10 * 60 * 1000) {
    return cachedModel;
  }

  if (!config.openRouterApiKey) {
    cachedModel = "google/gemma-4-31b-it:free";
    cachedAt = now;
    return cachedModel;
  }

  const resp = await axios.get(`${config.openRouterBaseUrl}/models`, {
    timeout: config.requestTimeoutMs,
    proxy: false,
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`
    }
  });

  const models = Array.isArray(resp.data?.data) ? resp.data.data : [];
  const freebies = models
    .filter((m) => parseNum(m?.pricing?.prompt) === 0 && parseNum(m?.pricing?.completion) === 0)
    .sort((a, b) => {
      const af = a.id.includes(":free") ? 0 : 1;
      const bf = b.id.includes(":free") ? 0 : 1;
      if (af !== bf) return af - bf;
      return (b.context_length || 0) - (a.context_length || 0);
    });

  cachedModel = freebies[0]?.id || "google/gemma-4-31b-it:free";
  cachedAt = now;
  return cachedModel;
}

function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitRateLimit() {
  const minInterval = 1200;
  const now = Date.now();
  const waitMs = Math.max(0, minInterval - (now - lastRequestAt));
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  lastRequestAt = Date.now();
}

function parseRetryAfterMs(error) {
  const retryAfter = Number(error.response?.headers?.["retry-after"]);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000;
  }
  return 2500;
}

function heuristicEvaluation({ monitor, item, model, reason }) {
  const q = String(monitor.query || "").toLowerCase();
  const hay = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const hitCount = terms.filter((t) => hay.includes(t)).length;
  const isRelevant = terms.length === 0 ? true : hitCount > 0;

  return {
    model,
    isRelevant,
    isCredible: true,
    confidence: isRelevant ? 0.42 : 0.22,
    reason: `${reason} (heuristic fallback)`,
    shouldNotify: isRelevant && monitor.type === "keyword"
  };
}

function buildMissingApiKeyEvaluation({ monitor, item, model }) {
  const heuristic = heuristicEvaluation({
    monitor,
    item,
    model,
    reason: "OpenRouter API key missing"
  });

  return {
    ...heuristic,
    reason: "OpenRouter API key missing, heuristic fallback result. Notifications disabled.",
    shouldNotify: false
  };
}

async function evaluateItem({ monitor, item }) {
  const model = await selectModel();

  if (!config.openRouterApiKey) {
    return buildMissingApiKeyEvaluation({ monitor, item, model });
  }

  const prompt = `You are a strict hot-topic verifier.\nReturn only JSON with keys: isRelevant,isCredible,confidence,reason,shouldNotify.\nMonitor type: ${monitor.type}\nMonitor query: ${monitor.query}\nCandidate title: ${item.title}\nCandidate summary: ${item.summary || ""}\nSource: ${item.source}\nURL: ${item.url}`;

  let response;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await waitRateLimit();
      response = await axios.post(
        `${config.openRouterBaseUrl}/chat/completions`,
        {
          model,
          temperature: 0,
          messages: [
            { role: "system", content: "Decide if the candidate is relevant and credible. JSON only." },
            { role: "user", content: prompt }
          ]
        },
        {
          timeout: config.requestTimeoutMs,
          proxy: false,
          headers: {
            Authorization: `Bearer ${config.openRouterApiKey}`,
            "HTTP-Referer": config.openRouterReferer,
            "X-Title": config.openRouterTitle,
            "Content-Type": "application/json"
          }
        }
      );
      break;
    } catch (error) {
      lastError = error;
      if (error.response?.status !== 429 || attempt === 2) {
        if (error.response?.status === 429) {
          return heuristicEvaluation({
            monitor,
            item,
            model,
            reason: "OpenRouter rate limited"
          });
        }
        throw error;
      }
      await sleep(parseRetryAfterMs(error));
    }
  }
  if (!response && lastError) {
    throw lastError;
  }

  const text = response.data?.choices?.[0]?.message?.content || "";
  const parsed = safeJsonParse(text) || {};

  const isRelevant = Boolean(parsed.isRelevant);
  const isCredible = Boolean(parsed.isCredible);
  const computedShouldNotify =
    typeof parsed.shouldNotify === "boolean"
      ? parsed.shouldNotify
      : (isRelevant && isCredible && monitor.type === "keyword");

  return {
    model,
    isRelevant,
    isCredible,
    confidence: Number(parsed.confidence) || 0,
    reason: String(parsed.reason || "No reason provided."),
    shouldNotify: Boolean(computedShouldNotify)
  };
}

module.exports = {
  evaluateItem,
  selectModel,
  __test: {
    heuristicEvaluation,
    buildMissingApiKeyEvaluation
  }
};
