const crypto = require("crypto");

function stableHash(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const removable = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "fbclid", "gclid"];
    removable.forEach((key) => parsed.searchParams.delete(key));
    return parsed.toString();
  } catch {
    return url;
  }
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  stableHash,
  normalizeUrl,
  nowIso
};
