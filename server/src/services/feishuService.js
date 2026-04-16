const axios = require("axios");
const { nowIso } = require("../utils/common");

async function sendFeishuNotification({ webhook, keyword, monitor, item, evaluation }) {
  if (!webhook) {
    return { ok: false, status: "skipped", message: "Webhook missing" };
  }

  const text = [
    keyword,
    `[${monitor.type.toUpperCase()}] ${monitor.query}`,
    `Title: ${item.title}`,
    `Source: ${item.source}`,
    `Credible: ${evaluation.isCredible}`,
    `Confidence: ${evaluation.confidence}`,
    `Reason: ${evaluation.reason}`,
    `URL: ${item.url}`,
    `Time: ${nowIso()}`
  ].join("\n");

  const payload = {
    msg_type: "text",
    content: {
      text
    }
  };

  const resp = await axios.post(webhook, payload, {
    headers: { "Content-Type": "application/json" },
    timeout: 10000,
    proxy: false
  });

  const success = resp.data?.code === 0;
  return {
    ok: success,
    status: success ? "sent" : "failed",
    response: resp.data,
    payload
  };
}

module.exports = { sendFeishuNotification };
