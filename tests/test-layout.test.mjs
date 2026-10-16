import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("skill bundles keep test files and directories in the repository's tests folder", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const skills = readdirSync(root, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md"))
  );
  expect(skills.length).toBeGreaterThan(0);
  const bundledTests = skills.flatMap((skill) =>
    readdirSync(join(root, skill.name), { recursive: true })
      .map((path) => `${skill.name}/${path.replaceAll("\\", "/")}`)
      .filter((path) =>
        /(^|\/)(?:tests?|__tests__)(\/|$)|(^|\/)test_[^/]*\.py$|\.(?:test|spec)\.[^/]+$/.test(path)
      )
  );
  expect(bundledTests).toEqual([]);
});
