import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("merge and squash readiness copies remain identical standalone resources", () => {
  const merge = readFileSync(
    new URL("../merge-pr/references/readiness.md", import.meta.url),
    "utf8",
  );
  const squash = readFileSync(
    new URL("../squash-pr/references/readiness.md", import.meta.url),
    "utf8",
  );
  expect(squash).toBe(merge);
});

test("PR metadata and babysitting retain identical status and thread query guidance", () => {
  const metadata = readFileSync(
    new URL("../update-pr-body/references/github.md", import.meta.url),
    "utf8",
  );
  const babysit = readFileSync(new URL("../babysit/references/github.md", import.meta.url), "utf8");
  const boundary = "\n## Reply to a thread\n";
  expect(babysit.includes(boundary)).toBe(true);
  expect(babysit.slice(0, babysit.indexOf(boundary)).trimEnd()).toBe(metadata.trimEnd());
});
