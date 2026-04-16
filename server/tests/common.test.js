const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUrl, stableHash } = require("../src/utils/common");

test("normalizes URL by removing trackers", () => {
  const out = normalizeUrl("https://example.com/a?utm_source=x&ok=1");
  assert.match(out, /ok=1/);
  assert.doesNotMatch(out, /utm_source/);
});

test("stableHash should be deterministic", () => {
  assert.equal(stableHash("abc"), stableHash("abc"));
});
