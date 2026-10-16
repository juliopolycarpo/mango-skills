import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../scripts/test-python.mjs", import.meta.url));

/** Run a copy of the Python runner in a temporary repository whose tests/ holds `suites`. */
function runInFixture(suites) {
  const root = mkdtempSync(join(tmpdir(), "skills-test-python-"));
  try {
    mkdirSync(join(root, "scripts"));
    copyFileSync(runner, join(root, "scripts", "test-python.mjs"));
    mkdirSync(join(root, "tests"));
    for (const [path, source] of Object.entries(suites)) {
      mkdirSync(join(root, "tests", path, ".."), { recursive: true });
      writeFileSync(join(root, "tests", path), source);
    }
    return spawnSync(process.execPath, [join(root, "scripts", "test-python.mjs")], {
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Python runner fails when tests/<skill>/python finds no suites", () => {
  const result = runInFixture({ "skill/javascript/helper.test.mjs": "" });
  expect(result.stderr).toContain(
    "(tests/*/python): expected at least one Python suite directory | received: none",
  );
  expect(result.status).toBe(1);
});

test("Python runner passes when a discovered suite passes", () => {
  const result = runInFixture({
    "skill/python/test_ok.py":
      "import unittest\n\nclass Ok(unittest.TestCase):\n    def test_ok(self):\n        pass\n",
  });
  expect(result.stderr).toContain("Ran 1 test");
  expect(result.status).toBe(0);
});
