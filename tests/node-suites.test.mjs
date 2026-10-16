import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Return the paths and patterns that the `test:node` script passes to `node --test`. */
function nodeTestArguments() {
  const { scripts } = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
  const [command, flag, ...files] = scripts["test:node"].split(/\s+/);
  expect(`${command} ${flag}`).toBe("node --test");
  return files.map((file) => file.replaceAll("\"", ""));
}

test("test:node selects every helper suite under tests/<skill>/javascript", () => {
  const suites = [...new Bun.Glob("tests/*/javascript/**/*.test.mjs").scanSync({ cwd: root })]
    .map((path) => path.replaceAll("\\", "/"));
  expect(suites.length).toBeGreaterThan(0);
  const selectors = nodeTestArguments().map((file) => new Bun.Glob(file));
  const unselected = suites.filter((suite) => !selectors.some((glob) => glob.match(suite)));
  expect(unselected).toEqual([]);
});
