const assert = require("node:assert/strict");
const { normalizeUrl, stableHash } = require("../src/utils/common");

function run(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

run("normalizeUrl removes tracker params", () => {
  const out = normalizeUrl("https://example.com/a?utm_source=x&ok=1");
  assert.match(out, /ok=1/);
  assert.doesNotMatch(out, /utm_source/);
});

run("stableHash deterministic", () => {
  assert.equal(stableHash("abc"), stableHash("abc"));
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
