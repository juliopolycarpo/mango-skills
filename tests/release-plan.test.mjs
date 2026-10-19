import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPackages } from "../scripts/package-skills.mjs";
import {
  checkReleaseRecord,
  isBreaking,
  nextVersion,
  payloadDigest,
  planRelease,
  releaseRecord,
} from "../scripts/release-plan.mjs";

const svg =
  "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><title>Icon</title><path d=\"M0 0\"/></svg>";
const SOURCE = "a".repeat(40);
function skill(name) {
  return {
    [`${name}/SKILL.md`]:
      `---\nname: ${name}\ndescription: Use when testing ${name} releases.\n---\n# ${name}\n\n[Guide](references/guide.md)\n`,
    [`${name}/agents/openai.yaml`]:
      `interface:\n  display_name: ${name} skill\n  short_description: Release the ${name} fixture skill\n  icon_small: ./assets/icon.svg\n  icon_large: ./assets/icon.svg\n  default_prompt: Use $${name} here.\n`,
    [`${name}/assets/icon.svg`]: svg,
    [`${name}/references/guide.md`]: "# Guide\n",
    [`${name}/LICENSE`]: "MIT\n",
  };
}
function fixture(files = {}, remove = []) {
  const root = mkdtempSync(join(tmpdir(), "release-plan-"));
  const all = {
    LICENSE: "MIT License\n",
    "assets/mango-skills.svg": svg,
    "README.md": "# Fixture\n",
    "package.json": "{}\n",
    "tests/alpha.test.mjs": "// test\n",
    ...skill("alpha"),
    ...skill("beta"),
    "beta/scripts/run.mjs": "#!/usr/bin/env node\nconsole.log('ok');\n",
    ...files,
  };
  for (const path of remove) {
    for (const key of Object.keys(all)) {
      if (key === path || key.startsWith(`${path}/`)) delete all[key];
    }
  }
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
function digestOf(files, remove) {
  const root = fixture(files, remove);
  try {
    return payloadDigest(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const base = digestOf();
const previous = releaseRecord({ version: "0.1.0", sourceSha: SOURCE, digest: base, archives: [] });
function plan(files = {}, remove = [], messages = ["fix(alpha): adjust wording"]) {
  return planRelease({ previous, digest: digestOf(files, remove), messages });
}

test("a documentation-only skill change is due as a patch for that skill", () => {
  const result = plan({ "alpha/SKILL.md": "---\nname: alpha\ndescription: Use when.\n---\n# A\n" });
  expect(result).toMatchObject({
    due: true,
    version: "0.1.1",
    changedSkills: [{ name: "alpha", change: "changed" }],
  });
});

test("helper and reference changes are due", () => {
  expect(plan({ "beta/scripts/run.mjs": "#!/usr/bin/env node\nconsole.log(1);\n" }))
    .toMatchObject({ due: true, changedSkills: [{ name: "beta", change: "changed" }] });
  expect(plan({ "alpha/references/guide.md": "# Guide\n\nMore.\n" }))
    .toMatchObject({ due: true, changedSkills: [{ name: "alpha", change: "changed" }] });
});

test("adding, removing and renaming a skill are due and name the skill", () => {
  expect(plan(skill("gamma")).changedSkills).toEqual([{ name: "gamma", change: "added" }]);
  expect(plan({}, ["beta"]).changedSkills).toEqual([{ name: "beta", change: "removed" }]);
  const renamed = plan(
    { ...skill("delta"), "delta/scripts/run.mjs": "#!/usr/bin/env node\nconsole.log('ok');\n" },
    ["beta"],
  );
  expect(renamed).toMatchObject({
    due: true,
    changedSkills: [{ name: "beta", change: "removed" }, { name: "delta", change: "added" }],
  });
});

test("changes to packaged root files are due", () => {
  expect(plan({ LICENSE: "MIT License\n\nCopyright\n" })).toMatchObject({
    due: true,
    changedSkills: [{ name: "alpha", change: "changed" }, { name: "beta", change: "changed" }],
  });
  const icon = plan({ "assets/mango-skills.svg": svg.replace("Icon", "Bundle") });
  expect(icon).toMatchObject({ due: true, changedSkills: [] });
  expect(icon.reason).toContain("outside skills");
});

test("changes outside the distributed payload are not due", () => {
  const result = plan({
    "tests/alpha.test.mjs": "// changed\n",
    "tests/new.test.mjs": "// new\n",
    ".github/workflows/check.yml": "name: Check\n",
    "README.md": "# Changed\n",
    "package.json": "{\"private\":true}\n",
  });
  expect(result).toMatchObject({ due: false, version: null, changedSkills: [] });
  expect(result.reason).toContain("v0.1.0");
});

test("two skills changed in one merge give one plan listing both", () => {
  const result = plan({
    "alpha/references/guide.md": "# Alpha\n",
    "beta/references/guide.md": "# Beta\n",
  });
  expect(result).toMatchObject({
    due: true,
    version: "0.1.1",
    changedSkills: [{ name: "alpha", change: "changed" }, { name: "beta", change: "changed" }],
  });
});

test("breaking markers bump the minor and never the major", () => {
  const files = { "alpha/references/guide.md": "# Breaking\n" };
  expect(plan(files, [], ["fix: one", "feat(alpha)!: drop the old flag"]).version).toBe("0.2.0");
  expect(plan(files, [], ["refactor: rename\n\nBREAKING CHANGE: the old name is gone"]).version)
    .toBe("0.2.0");
  expect(nextVersion("1.4.2", ["feat!: remove"])).toBe("1.5.0");
  expect(nextVersion("1.4.2", ["fix: patch", "docs: words"])).toBe("1.4.3");
});

test("breaking detection follows the Conventional Commits markers only", () => {
  expect(isBreaking("feat!: drop")).toBe(true);
  expect(isBreaking("fix(scope)!: drop")).toBe(true);
  expect(isBreaking("chore: tidy\n\nBREAKING-CHANGE: removed")).toBe(true);
  expect(isBreaking("chore: tidy\n\nBREAKING CHANGE: removed")).toBe(true);
  expect(isBreaking("fix: mention BREAKING CHANGE: in the subject")).toBe(false);
  expect(isBreaking("fix: tidy\n\nNot a BREAKING CHANGE: marker")).toBe(false);
  expect(isBreaking("feat!add: missing colon placement")).toBe(false);
  expect(isBreaking("fix: tidy\n\nbreaking change: lowercase")).toBe(false);
});

test("the first release is 0.1.0 and lists every skill as added", () => {
  expect(nextVersion(null, ["feat!: anything"])).toBe("0.1.0");
  expect(planRelease({ previous: null, digest: base, messages: [] })).toMatchObject({
    due: true,
    version: "0.1.0",
    changedSkills: [{ name: "alpha", change: "added" }, { name: "beta", change: "added" }],
  });
});

test("a previous version that is not MAJOR.MINOR.PATCH is rejected by value", () => {
  for (const value of ["v1.2.3", "1.2", "1.2.3-rc.1", "01.2.3"]) {
    expect(() => nextVersion(value, [])).toThrow(
      `(previous version): expected MAJOR.MINOR.PATCH such as 0.1.0 | received: "${value}"`,
    );
  }
});

test("a malformed previous release record is rejected by field", () => {
  expect(() =>
    planRelease({ previous: { ...previous, payloadDigest: undefined }, digest: base, messages: [] })
  ).toThrow("(release.json payloadDigest): expected sha256:<64 hex> | received: missing");
  expect(() => checkReleaseRecord({ ...previous, sourceSha: "abc" })).toThrow(
    "(release.json sourceSha): expected 40-character commit SHA | received: \"abc\"",
  );
  expect(() => checkReleaseRecord(previous)).not.toThrow();
});

test("the digest ignores the release version and built archives", () => {
  const root = fixture();
  try {
    const before = payloadDigest(root);
    buildPackages({ root, version: "1.2.3", out: join(root, "dist") });
    buildPackages({ root, version: "4.5.6", out: join(root, "dist") });
    expect(payloadDigest(root)).toEqual(before);
    expect(before).toEqual(base);
    expect(before.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.keys(before.skills)).toEqual(["alpha", "beta"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the release record holds the version, source, digests and archive hashes", () => {
  const record = releaseRecord({
    version: "0.1.1",
    sourceSha: SOURCE,
    digest: base,
    archives: [{ file: "mango-skills-0.1.1.zip", sha256: "b".repeat(64) }],
  });
  expect(record).toEqual({
    name: "mango-skills",
    version: "0.1.1",
    tag: "v0.1.1",
    sourceSha: SOURCE,
    payloadDigest: base.digest,
    skills: base.skills,
    files: { "mango-skills-0.1.1.zip": "b".repeat(64) },
  });
});
