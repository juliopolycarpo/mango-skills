import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testPath =
  /(^|\/)(?:tests?|__tests__)(\/|$)|(^|\/)(?:test_[^/]*|conftest)\.py$|[._](?:test|spec)\.[^/]+$/;
const ignoredPath = /(^|\/)(?:node_modules|\.git|__pycache__)(\/|$)/;

test("skill bundles keep test files and directories in the repository's tests folder", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const skills = readdirSync(root, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory() && (
      existsSync(join(root, entry.name, "SKILL.md"))
      || existsSync(join(root, entry.name, "agents/openai.yaml"))
    )
  );
  expect(skills.length).toBeGreaterThan(0);
  const bundledTests = skills.flatMap((skill) =>
    readdirSync(join(root, skill.name), { recursive: true })
      .map((path) => path.replaceAll("\\", "/"))
      .filter((path) => !ignoredPath.test(path) && testPath.test(path))
      .map((path) => `${skill.name}/${path}`)
  );
  expect(bundledTests).toEqual([]);
});
