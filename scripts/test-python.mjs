import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Run the repository's Python unittest suites with one interpreter; PYTHON overrides the default.
 * Example: PYTHON=py bun scripts/test-python.mjs
 */
function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const tests = join(root, "tests");
  const suites = readdirSync(tests, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(tests, entry.name, "python"))
    .filter((directory) => existsSync(directory));
  let failed = 0;
  for (const suite of suites) {
    const result = spawnSync(python, ["-I", "-m", "unittest", "discover", "-s", suite], {
      stdio: "inherit",
    });
    if (result.status === 0) continue;
    failed++;
    console.error(
      `(${suite}): expected unittest exit 0 | received: ${result.status ?? result.error?.message}`,
    );
  }
  process.exitCode = failed ? 1 : 0;
}

main();
