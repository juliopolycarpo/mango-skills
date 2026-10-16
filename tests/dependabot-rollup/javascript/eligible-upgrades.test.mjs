import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assess,
  createEvidence,
  discoverActions,
  discoverChanges,
  discoverManifest,
  extractUses,
  main,
  satisfiesRange,
} from "../../../dependabot-rollup/scripts/javascript/eligible-upgrades.mjs";

/** Assert every expected field of `actual` deep-equals its expectation (shallow partial match). */
function assertMatches(actual, expected) {
  for (const [field, value] of Object.entries(expected)) {
    assert.deepEqual(actual[field], value, `field ${field}`);
  }
}

// Fixture history uses synthetic objects; signing/commit hooks are outside these read-only tests.
function commitFixture(git, message) {
  let parent;
  try {
    parent = git("rev-parse", "--verify", "--quiet", "HEAD");
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  const tree = git("write-tree");
  const commit = git("commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message);
  git("update-ref", "HEAD", commit);
  return commit;
}

const cutoff = Date.parse("2026-10-12T00:00:00Z");
const release = (version, fields = {}) => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: false,
  published_at: "2026-10-01T00:00:00Z",
  ...fields,
});
function fakeEvidence({ metadata, responses = {} } = {}) {
  return {
    requests: [],
    async npm(name) {
      this.requests.push(`npm:${name}`);
      return metadata ?? { status: "error", reason: "Unexpected npm request" };
    },
    async github(endpoint) {
      this.requests.push(endpoint);
      if (!Object.hasOwn(responses, endpoint)) {
        throw new Error(`Unexpected GitHub request: ${endpoint}`);
      }
      return responses[endpoint];
    },
  };
}
const npmRow = (declaration = "1.0.0") =>
  discoverManifest(
    "package.json",
    {},
    { dependencies: { pkg: declaration } },
  )[0];
const actionRow = (current = "v4.0.0") => ({
  kind: "action",
  name: "owner/action",
  current,
  coverage: "exact",
});
const listing = (page) => `repos/owner/action/releases?per_page=100&page=${page}`;
const tags = (version) => [
  `v${version}`,
  version,
  `pkg@${version}`,
  `pkg-v${version}`,
];
const missingTags = (version) =>
  Object.fromEntries(
    tags(version).map((tag) => [
      `repos/owner/repo/releases/tags/${encodeURIComponent(tag)}`,
      { status: "not_found" },
    ]),
  );

test("manifest discovery ignores own version and engines; preserves paths, sections and previous value", () => {
  const before = { dependencies: { pkg: "0.9.0", unchanged: "1.0.0" } };
  const after = {
    version: "0.7.1",
    engines: { bun: "1.4.3" },
    dependencies: { pkg: "1.0.0", unchanged: "1.0.0" },
    devDependencies: { pkg: "2.0.0" },
  };
  const rows = discoverManifest("apps/a/package.json", before, after);
  assert.deepEqual(rows.map((row) => row.id), [
    "apps/a/package.json#dependencies:pkg",
    "apps/a/package.json#devDependencies:pkg",
  ]);
  assert.equal(rows[0].previous, "0.9.0");
  assert.equal(rows[0].current, "1.0.0");
  assert.notEqual(
    discoverManifest("apps/b/package.json", before, after)[0].id,
    rows[0].id,
  );
});

test("aliases, ranges, preview pins and unsupported declarations remain visible", () => {
  const rows = discoverManifest(
    "package.json",
    {},
    {
      dependencies: {
        alias: "npm:@scope/pkg@^1.0.0",
        preview: "7.0.0-dev.1",
        tag: "latest",
        local: "workspace:*",
        range: "~2.0.0",
      },
    },
    { "package.json#dependencies:alias": "1.2.0" },
  );
  assert.deepEqual(rows.map((row) => row.coverage), [
    "range",
    "preview-or-tag",
    "preview-or-tag",
    "unsupported",
    "range",
  ]);
  assertMatches(rows[0], {
    alias: true,
    package: "@scope/pkg",
    current: "1.2.0",
    declaration: "npm:@scope/pkg@^1.0.0",
  });
  assert.equal(rows[4].current, null);
});

test("YAML action discovery includes SHA version comments and unsupported major/local/image forms", () => {
  const yaml = `jobs:\n  test:\n    steps:\n      - uses: owner/action@${
    "a".repeat(40)
  } # v4.1.0\n      - uses: owner/other@v3\n      - uses: ./local\n      - uses: docker://image:1\n`;
  const rows = discoverActions(".github/workflows/ci.yml", "", yaml);
  assert.equal(rows.length, 4);
  assertMatches(rows[0], {
    current: "v4.1.0",
    pin: "a".repeat(40),
    coverage: "exact",
  });
  assert.equal(rows.slice(1).every((row) => row.coverage === "unsupported"), true);
  assert.deepEqual(discoverActions("ci.yml", yaml, yaml), []);
});

test("empty uses retains changed continuation text as unsupported evidence", async () => {
  const before = "steps:\n  - uses:\n      owner/action@v1.0.0\n";
  const after = before.replace("v1.0.0", "v2.0.0");
  const rows = discoverActions("ci.yml", before, after);
  assert.equal(rows.length, 1, "expected one unsupported changed multiline uses declaration");
  assert.equal(rows[0].declaration, "uses:\n      owner/action@v2.0.0");
  assert.equal(rows[0].coverage, "unsupported");
  const evidence = fakeEvidence();
  assert.equal((await assess(rows[0], evidence, cutoff)).completeness, "unknown");
  assert.deepEqual(evidence.requests, []);
  assert.deepEqual(extractUses("uses: # next line\n  owner/action@v1.0.0"), [
    "uses:\n  owner/action@v1.0.0",
  ]);
});

test("action discovery retains added occurrences after reordered existing pins", () => {
  const before = "steps:\n  - uses: owner/action@v1.0.0\n  - uses: owner/action@v2.0.0\n";
  const after =
    "steps:\n  - uses: owner/action@v2.0.0\n  - uses: owner/action@v1.0.0\n  - uses: owner/action@v2.0.0\n";
  const rows = discoverActions("ci.yml", before, after);
  assert.deepEqual(rows.map((row) => [row.id, row.current, row.coverage]), [
    ["ci.yml#uses:2:owner/action@v2.0.0", "v2.0.0", "exact"],
  ]);
  assert.deepEqual(discoverActions("ci.yml", before, before), []);
});

test("action discovery covers a step adopting a pin already used by another step", () => {
  const before =
    "steps:\n  - name: first\n    uses: owner/action@v1.0.0\n  - name: second\n    uses: owner/action@v2.0.0\n";
  const after = before.replace("@v1.0.0", "@v2.0.0");
  const rows = discoverActions("ci.yml", before, after);
  assert.deepEqual(rows.map((row) => [row.declaration, row.current]), [
    ["owner/action@v2.0.0", "v2.0.0"],
  ]);
});

test("action discovery retains added unsupported major-pin occurrences with unknown evidence", async () => {
  const before = "steps:\n  - uses: owner/action@v2\n";
  const rows = discoverActions("ci.yml", before, `${before}  - uses: owner/action@v2\n`);
  assert.deepEqual(rows.map((row) => [row.id, row.current, row.coverage]), [
    ["ci.yml#uses:1:owner/action@v2", null, "unsupported"],
  ]);
  const evidence = fakeEvidence();
  const result = await assess(rows[0], evidence, cutoff);
  assert.equal(result.current_evidence.status, "unknown");
  assert.equal(result.completeness, "unknown");
  assert.deepEqual(evidence.requests, []);
});

test("duplicated SHA declarations cannot borrow another occurrence's version comment", () => {
  const declaration = `owner/action@${"a".repeat(40)}`;
  const after = `steps:\n  - uses: ${declaration} # v1.0.0\n  - uses: ${declaration} # v2.0.0\n`;
  const rows = discoverActions("ci.yml", "", after);
  assert.deepEqual(rows.map((row) => [row.current, row.coverage]), [
    [null, "unsupported"],
    [null, "unsupported"],
  ]);
  assert.deepEqual(discoverActions("ci.yml", after, after), []);
  const changed = discoverActions("ci.yml", `steps:\n  - uses: ${declaration} # v1.0.0\n`, after);
  assert.deepEqual(changed.map((row) => [row.id, row.current, row.coverage]), [
    [`ci.yml#uses:1:${declaration}`, null, "unsupported"],
  ]);
});

test("SHA version evidence excludes ambiguous source text and multiple uses on one line", () => {
  const declaration = `owner/action@${"a".repeat(40)}`;
  const source = `steps:\n  - run: echo '${declaration}' # v1.0.0\n  - uses: ${declaration}\n`;
  const rows = discoverActions("ci.yml", "", source);
  assert.deepEqual(rows.map((row) => [row.current, row.coverage]), [[null, "unsupported"]]);
  const flow = `steps: [{uses: ${declaration}}, {uses: ${declaration}}] # v1.0.0`;
  assert.deepEqual(discoverActions("ci.yml", "", flow).map((row) => row.current), [null, null]);
});

test("missing current publication evidence is unknown even with a valid GitHub release", async () => {
  const evidence = fakeEvidence({
    metadata: {
      status: "ok",
      data: {
        versions: { "1.0.0": {} },
        time: {},
        repository: "https://github.com/owner/repo.git",
      },
    },
    responses: {
      "repos/owner/repo/releases/tags/v1.0.0": {
        status: "ok",
        data: release("1.0.0"),
      },
    },
  });
  const row = await assess(npmRow(), evidence, cutoff);
  assert.equal(row.current_evidence.status, "unknown");
  assert.equal(row.completeness, "unknown");
});

test("403 lookup remains unknown; 404 exhausts tag patterns and is ineligible", async () => {
  const metadata = {
    status: "ok",
    data: {
      versions: { "1.0.0": {} },
      time: { "1.0.0": "2026-10-01" },
      repository: { url: "git+https://github.com/owner/repo.git" },
    },
  };
  const denied = await assess(
    npmRow(),
    fakeEvidence({
      metadata,
      responses: {
        "repos/owner/repo/releases/tags/v1.0.0": {
          status: "error",
          reason: "HTTP 403",
        },
      },
    }),
    cutoff,
  );
  assert.deepEqual(denied.current_evidence, {
    status: "unknown",
    reason: "HTTP 403",
  });
  const missing = await assess(
    npmRow(),
    fakeEvidence({ metadata, responses: missingTags("1.0.0") }),
    cutoff,
  );
  assert.equal(missing.current_evidence.status, "ineligible");
  assert.match(missing.current_evidence.reason, /404/);
});

test("checks current release age and candidate GitHub publication age, excludes preview candidates", async () => {
  const versions = ["1.0.0", "1.1.0", "1.2.0", "2.0.0-beta.1"];
  const metadata = {
    status: "ok",
    data: {
      versions: Object.fromEntries(versions.map((version) => [version, {}])),
      time: Object.fromEntries(
        versions.map((version) => [version, "2026-10-01"]),
      ),
      repository: "https://github.com/owner/repo",
    },
  };
  const responses = Object.fromEntries(
    versions
      .slice(0, 3)
      .map((version) => [
        `repos/owner/repo/releases/tags/v${version}`,
        {
          status: "ok",
          data: release(
            version,
            version !== "1.1.0" ? { published_at: "2026-10-14" } : {},
          ),
        },
      ]),
  );
  const result = await assess(
    npmRow(),
    fakeEvidence({ metadata, responses }),
    cutoff,
  );
  assert.equal(result.current_evidence.status, "ineligible");
  assert.equal(result.eligible, "1.1.0");
  assertMatches(result.candidates[0], { version: "1.2.0", status: "ineligible" });
  assert.deepEqual(result.preview_versions, ["2.0.0-beta.1"]);
});

test("paginates beyond first 100 releases to current; respects pinned action major", async () => {
  const page1 = Array.from({ length: 100 }, () => release("9.0.0"));
  const evidence = fakeEvidence({
    responses: {
      [listing(1)]: { status: "ok", data: page1 },
      [listing(2)]: {
        status: "ok",
        data: [release("4.1.0"), release("4.0.0")],
      },
    },
  });
  const result = await assess(actionRow(), evidence, cutoff);
  assert.deepEqual(evidence.requests, [listing(1), listing(2)]);
  assertMatches(result, {
    eligible: "v4.1.0",
    recommendation: "eligible-newer-version",
    completeness: "complete",
  });
  assert.equal(result.current_evidence.status, "eligible");
});

test("action current evidence matches the exact tag, including its v prefix", async () => {
  for (const current of ["4.0.0", "v4.0.0"]) {
    const otherTag = current.startsWith("v") ? "4.0.0" : "v4.0.0";
    const evidence = fakeEvidence({
      responses: {
        [listing(1)]: { status: "ok", data: [release("4.0.0", { tag_name: otherTag })] },
      },
    });
    const result = await assess(actionRow(current), evidence, cutoff);
    assert.equal(
      result.current_evidence.status,
      "unknown",
      `expected unknown evidence for ${current} from ${otherTag}`,
    );
    assert.equal(result.completeness, "unknown");
  }
});

test("failed pagination or missing current release never passes current age policy", async () => {
  const incomplete = await assess(
    actionRow(),
    fakeEvidence({
      responses: { [listing(1)]: { status: "error", reason: "HTTP 429" } },
    }),
    cutoff,
  );
  assert.deepEqual(incomplete.current_evidence, {
    status: "unknown",
    reason: "HTTP 429",
  });
  const missing = await assess(
    actionRow(),
    fakeEvidence({
      responses: { [listing(1)]: { status: "ok", data: [release("4.1.0")] } },
    }),
    cutoff,
  );
  assert.equal(missing.current_evidence.status, "unknown");
  assert.equal(missing.completeness, "unknown");
});

test("SHA comment must resolve to pinned action commit", async () => {
  const row = { ...actionRow(), pin: "a".repeat(40) };
  const responses = {
    [listing(1)]: { status: "ok", data: [release("4.0.0")] },
    "repos/owner/action/commits/v4.0.0": {
      status: "ok",
      data: { sha: "b".repeat(40) },
    },
  };
  const result = await assess(row, fakeEvidence({ responses }), cutoff);
  assert.deepEqual(result.current_evidence, {
    status: "unknown",
    reason: "Pinned SHA does not match version tag",
  });
});

test("no newer stable version is distinct from newer versions that fail policy", async () => {
  const equal = await assess(
    actionRow(),
    fakeEvidence({
      responses: { [listing(1)]: { status: "ok", data: [release("4.0.0")] } },
    }),
    cutoff,
  );
  assert.equal(equal.recommendation, "no-newer-stable-version");
  const young = await assess(
    actionRow(),
    fakeEvidence({
      responses: {
        [listing(1)]: {
          status: "ok",
          data: [
            release("4.0.0"),
            release("4.1.0", { published_at: "2026-10-14" }),
          ],
        },
      },
    }),
    cutoff,
  );
  assert.equal(young.recommendation, "no-eligible-newer-version");
});

test("unresolved ranges and previews perform no external I/O", async () => {
  const evidence = fakeEvidence();
  for (
    const declaration of [
      "^1.0.0",
      "latest",
      "1.0.0-beta.1",
      "workspace:*",
    ]
  ) {
    const result = await assess(npmRow(declaration), evidence, cutoff);
    assert.equal(result.completeness, "unknown");
  }
  assert.deepEqual(evidence.requests, []);
});

test("structural inventory reads merge-base manifests and added files in isolated git repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-dependency-audit-"));
  const config = join(dir, "fixture.gitconfig");
  writeFileSync(config, "");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: config,
        GIT_CONFIG_NOSYSTEM: "1",
      },
    }).trim();
  const previous = process.cwd();
  try {
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ version: "0.7.0", dependencies: { pkg: "1.0.0" } }),
    );
    git("add", ".");
    commitFixture(git, "base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ version: "0.7.1", dependencies: { pkg: "1.1.0" } }),
    );
    mkdirSync(join(dir, "new"));
    writeFileSync(
      join(dir, "new/package.json"),
      JSON.stringify({ devDependencies: { pkg: "2.0.0" } }),
    );
    writeFileSync(join(dir, "Cargo.toml"), "[package]\nname=\"fixture\"");
    git("add", ".");
    commitFixture(git, "candidate");
    process.chdir(dir);
    const inventory = discoverChanges(base, "HEAD");
    assert.deepEqual(inventory.rows.map((row) => row.id), [
      "new/package.json#devDependencies:pkg",
      "package.json#dependencies:pkg",
    ]);
    assert.deepEqual(inventory.uncovered, [
      { path: "Cargo.toml", coverage: "unsupported-ecosystem" },
    ]);
  } finally {
    process.chdir(previous);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI reports changed non-inline uses as unsupported with exit 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "fix-published-skill-review-action-"));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(dir, "fixture.gitconfig"),
  };
  const git = (...args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
  try {
    writeFileSync(env.GIT_CONFIG_GLOBAL, "");
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    mkdirSync(join(dir, ".github/workflows"), { recursive: true });
    const workflow = join(dir, ".github/workflows/ci.yml");
    const before = "steps:\n  - uses:\n      owner/action@v1.0.0\n";
    writeFileSync(workflow, before);
    git("add", ".");
    const base = commitFixture(git, "base");
    writeFileSync(workflow, before.replace("v1.0.0", "v2.0.0"));
    git("add", ".");
    commitFixture(git, "changed action");
    const result = spawnSync(process.execPath, [
      fileURLToPath(
        new URL(
          "../../../dependabot-rollup/scripts/javascript/eligible-upgrades.mjs",
          import.meta.url,
        ),
      ),
      "--base",
      base,
      "--json",
    ], {
      cwd: dir,
      env,
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      2,
      `expected unsupported non-inline uses exit 2; stderr: ${result.stderr}`,
    );
    const report = JSON.parse(result.stdout);
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].coverage, "unsupported");
    assert.equal(report.rows[0].current_evidence.status, "unknown");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI rejects invalid flags and age before accessing repository/network", async () => {
  await assert.rejects(
    main(["--min-days", "-1"]),
    /expected finite nonnegative/,
  );
  await assert.rejects(main(["--base"]), /Invalid argument --base/);
  assert.equal(typeof createEvidence().npm, "function");
});

test("resolved version outside declaration range remains unknown", async () => {
  const row = discoverManifest(
    "package.json",
    {},
    { dependencies: { pkg: "^1.0.0" } },
    { "package.json#dependencies:pkg": "2.0.0" },
  )[0];
  assert.equal(row.current, null);
  const result = await assess(row, fakeEvidence(), cutoff);
  assert.equal(
    result.current_evidence.reason,
    "Resolved version 2.0.0 does not satisfy ^1.0.0",
  );
});

function fakeFetchResponse(status, data) {
  return async function fetchRegistry() {
    return {
      status,
      ok: status >= 200 && status < 300,
      async json() {
        return data;
      },
    };
  };
}
function fakeGhResponse(status, data, exit = 0) {
  return function runGh(command, args) {
    assert.equal(command, "gh");
    assert.deepEqual(args.slice(0, 2), ["api", "--include"]);
    return {
      status: exit,
      stdout: `HTTP/2.0 ${status}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}`,
      stderr: exit ? `HTTP ${status}` : "",
    };
  };
}

test("transport normalizes CRLF GitHub headers and distinguishes 404 and 403", async () => {
  const ok = createEvidence({
    run: fakeGhResponse(200, release("1.0.0")),
    fetcher: fakeFetchResponse(200, { versions: {} }),
  });
  assert.equal(
    (await ok.github("repos/owner/repo/releases")).data.tag_name,
    "v1.0.0",
  );
  assert.equal((await ok.npm("@scope/pkg")).status, "ok");
  const missing = createEvidence({
    run: fakeGhResponse(404, {}, 1),
    fetcher: fakeFetchResponse(404, {}),
  });
  assert.equal((await missing.github("missing")).status, "not_found");
  assert.equal((await missing.npm("missing")).status, "not_found");
  const denied = createEvidence({
    run: fakeGhResponse(403, {}, 1),
    fetcher: fakeFetchResponse(403, {}),
  });
  assert.deepEqual(await denied.github("denied"), {
    status: "error",
    reason: "HTTP 403",
  });
  assert.deepEqual(await denied.npm("denied"), {
    status: "error",
    reason: "HTTP 403",
  });
});

test("higher candidate lookup errors keep highest eligible recommendation unknown", async () => {
  const metadata = {
    status: "ok",
    data: {
      versions: { "1.0.0": {}, "1.1.0": {}, "1.2.0": {} },
      time: {
        "1.0.0": "2026-10-01",
        "1.1.0": "2026-10-01",
        "1.2.0": "2026-10-01",
      },
      repository: "https://github.com/owner/repo",
    },
  };
  const responses = {
    "repos/owner/repo/releases/tags/v1.0.0": {
      status: "ok",
      data: release("1.0.0"),
    },
    "repos/owner/repo/releases/tags/v1.1.0": {
      status: "ok",
      data: release("1.1.0"),
    },
    "repos/owner/repo/releases/tags/v1.2.0": {
      status: "error",
      reason: "Network failure",
    },
  };
  const result = await assess(
    npmRow(),
    fakeEvidence({ metadata, responses }),
    cutoff,
  );
  assert.equal(result.eligible, "1.1.0");
  assert.equal(result.recommendation, "unknown");
  assert.equal(result.completeness, "unknown");
});

test("resolution mappings cannot override exact manifest pins", () => {
  const row = discoverManifest("package.json", {}, { dependencies: { pkg: "1.0.0" } }, {
    "package.json#dependencies:pkg": "2.0.0",
  })[0];
  assert.equal(row.current, "1.0.0");
});

test("renamed manifests and workflows retain old-path comparison and changed declarations", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-dependency-renames-"));
  const config = join(dir, "fixture.gitconfig");
  writeFileSync(config, "");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" },
    }).trim();
  const previous = process.cwd();
  const manifest = (version) =>
    JSON.stringify(
      {
        name: "fixture",
        description: "Rename detection fixture ".repeat(60),
        dependencies: { changed: version, unchanged: "1.0.0" },
      },
      null,
      2,
    );
  const workflow = (version) =>
    `name: Fixture\n# ${
      "Rename detection fixture ".repeat(60)
    }\njobs:\n  test:\n    steps:\n      - uses: owner/changed@${version}\n      - uses: owner/unchanged@v1.0.0\n`;
  try {
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    mkdirSync(join(dir, "old"));
    writeFileSync(join(dir, "old/package.json"), manifest("1.0.0"));
    writeFileSync(join(dir, "old/ci.yml"), workflow("v1.0.0"));
    git("add", ".");
    commitFixture(git, "base");
    const base = git("rev-parse", "HEAD");
    rmSync(join(dir, "old"), { recursive: true });
    mkdirSync(join(dir, "new"));
    writeFileSync(join(dir, "new/package.json"), manifest("2.0.0"));
    writeFileSync(join(dir, "new/ci.yml"), workflow("v2.0.0"));
    git("add", ".");
    commitFixture(git, "rename and upgrade");
    assert.equal(
      git("diff", "--name-status", base, "HEAD").split("\n").every((line) => line.startsWith("R")),
      true,
    );
    process.chdir(dir);
    const inventory = discoverChanges(base, "HEAD");
    assert.deepEqual(inventory.rows.map((row) => row.name), ["owner/changed", "changed"]);
    assertMatches(inventory.rows[0], { path: "new/ci.yml", current: "v2.0.0" });
    assertMatches(inventory.rows[1], {
      path: "new/package.json",
      previous: "1.0.0",
      current: "2.0.0",
    });
  } finally {
    process.chdir(previous);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("moving branch refs cannot change inventoried declarations or reported receipt", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-dependency-ref-race-"));
  const config = join(dir, "fixture.gitconfig");
  writeFileSync(config, "");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" },
    }).trim();
  const previous = process.cwd();
  const manifest = (version) => JSON.stringify({ dependencies: { pkg: version } });
  try {
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    writeFileSync(join(dir, "package.json"), manifest("1.0.0"));
    git("add", ".");
    commitFixture(git, "base");
    const base = git("rev-parse", "HEAD");
    git("branch", "base-ref", base);
    writeFileSync(join(dir, "package.json"), manifest("1.1.0"));
    git("add", ".");
    commitFixture(git, "reviewed candidate");
    const reviewedHead = git("rev-parse", "HEAD");
    git("branch", "candidate-ref", reviewedHead);
    writeFileSync(join(dir, "package.json"), manifest("9.0.0"));
    git("add", ".");
    commitFixture(git, "concurrent advance");
    const advancedHead = git("rev-parse", "HEAD");
    let advanced = false;
    const requests = [];
    function gitWithConcurrentAdvance(args) {
      requests.push(args);
      const output = git(...args);
      if (args[0] === "merge-base") {
        git("update-ref", "refs/heads/candidate-ref", advancedHead);
        git("update-ref", "refs/heads/base-ref", advancedHead);
        advanced = true;
      }
      return output;
    }
    process.chdir(dir);
    const inventory = discoverChanges("base-ref", "candidate-ref", {}, gitWithConcurrentAdvance);
    assert.equal(advanced, true);
    assert.equal(git("rev-parse", "candidate-ref"), advancedHead);
    assert.equal(inventory.rows[0].current, "1.1.0");
    assert.equal(inventory.head, reviewedHead);
    assert.equal(inventory.base, base);
    assert.equal(requests.filter((args) => args[0] === "rev-parse").length, 2);
  } finally {
    process.chdir(previous);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("satisfiesRange follows npm caret, tilde and exact semantics for stable versions", () => {
  const cases = [
    ["1.2.5", "^1.0.0", true],
    ["1.0.0", "^1.0.0", true],
    ["2.0.0", "^1.0.0", false],
    ["0.9.9", "^1.0.0", false],
    ["1.2.2", "^1.2.3", false],
    ["0.2.9", "^0.2.3", true],
    ["0.3.0", "^0.2.3", false],
    ["0.0.3", "^0.0.3", true],
    ["0.0.4", "^0.0.3", false],
    ["1.2.9", "~1.2.3", true],
    ["1.3.0", "~1.2.3", false],
    ["1.9.9", "~1.2.3", false],
    ["v1.2.5", "^1.0.0", true],
    ["1.2.3", "1.2.3", true],
    ["1.2.4", "1.2.3", false],
    ["1.2.3-beta.1", "^1.0.0", false],
    ["1.2.3", "latest", false],
    ["1.2.3", ">=1.0.0", false],
  ];
  for (const [version, spec, expected] of cases) {
    assert.equal(satisfiesRange(version, spec), expected, `${version} vs ${spec}`);
  }
});

test("extractUses reads nested jobs/steps, quoted values, comments and flow maps in document order", () => {
  const yaml = [
    "name: CI",
    "on: [push]",
    "jobs:",
    "  build:",
    "    uses: owner/reusable/.github/workflows/build.yml@v1",
    "    steps:",
    "      - uses: actions/checkout@v4 # pinned",
    "      - name: quoted",
    "        uses: \"owner/double@v2\"",
    "      - uses: 'owner/single@v3' # trailing",
    "      - run: |",
    "          echo 'uses: not/an-action@v0'",
    "          uses: also/not@v0",
    "      - { name: flow, uses: owner/flow@v5 }",
    "      - uses: ./local",
    "      - uses: docker://image:1",
    "      - uses: ${{ matrix.action }}",
    "      - uses:",
    "      - with:",
    "          uses: owner/nested@v6",
    "",
  ].join("\n");
  assert.deepEqual(extractUses(yaml), [
    "owner/reusable/.github/workflows/build.yml@v1",
    "actions/checkout@v4",
    "owner/double@v2",
    "owner/single@v3",
    "owner/flow@v5",
    "./local",
    "docker://image:1",
    "${{ matrix.action }}",
    "uses:",
    "owner/nested@v6",
  ]);
  assert.deepEqual(extractUses(""), []);
  assert.deepEqual(extractUses("uses: owner/crlf@v1\r\n"), ["owner/crlf@v1"]);
});

test("extractUses resolves anchors and tags, and surfaces unreadable uses values raw", () => {
  assert.deepEqual(
    extractUses("steps:\n  - uses: &co actions/checkout@v5\n  - uses: *co\n"),
    ["actions/checkout@v5", "*co"],
  );
  assert.deepEqual(extractUses("uses: !!str owner/tag@v1"), ["owner/tag@v1"]);
  assert.deepEqual(extractUses("uses: &a !t \"owner/both@v2\""), ["owner/both@v2"]);
  assert.deepEqual(extractUses("uses: &only"), ["&only"]);
  assert.deepEqual(extractUses("uses: |\n  owner/block@v1\nnext: x"), ["|"]);
  assert.deepEqual(extractUses("uses: >-\n  owner/folded@v1"), [">-"]);
  assert.deepEqual(extractUses("uses: [owner/a@v1, b]"), ["[owner/a@v1, b]"]);
  assert.deepEqual(extractUses("uses: 'open\n  quote@v1'\nuses: after/q@v1"), [
    "'open",
    "after/q@v1",
  ]);
  assert.deepEqual(extractUses("uses: *alias # note"), ["*alias"]);
});

test("extractUses reads explicit mapping keys", () => {
  assert.deepEqual(extractUses("? uses\n: actions/checkout@v5\n"), ["actions/checkout@v5"]);
  assert.deepEqual(extractUses("- ? \"uses\"\n  : *x\n"), ["*x"]);
  assert.deepEqual(extractUses("? other\n: actions/skip@v1\n"), []);
  assert.deepEqual(extractUses("? uses\nname: x\n"), []);
});

test("extractUses never invents values from quoted text, block scalars or flow content", () => {
  assert.deepEqual(extractUses("run: \"echo '{uses: evil/x@v1}'\""), []);
  assert.deepEqual(extractUses("other: \"a, uses: evil@v1 {\""), []);
  assert.deepEqual(extractUses("args:\n  - |\n    uses: evil/y@v1\n"), []);
  assert.deepEqual(extractUses("args:\n  - >-\n    uses: evil/y@v1\nuses: real/a@v1\n"), [
    "real/a@v1",
  ]);
  assert.deepEqual(extractUses("run: \"echo\n  uses: evil/z@v2\"\nuses: real/b@v1"), ["real/b@v1"]);
  assert.deepEqual(extractUses("- \"echo\n  uses: evil/z@v2\"\n- uses: real/c@v1"), ["real/c@v1"]);
  assert.deepEqual(extractUses("x: {a: \"evil, uses: bad@v1\"}"), []);
  assert.deepEqual(extractUses("x: {a: 'it''s, uses: bad@v1'}"), []);
});

test("extractUses reads multi-line and nested flow mappings without trailing delimiters", () => {
  assert.deepEqual(extractUses("- {name: a,\n   uses: o/a@v1}\n- uses: next/b@v1"), [
    "o/a@v1",
    "next/b@v1",
  ]);
  assert.deepEqual(extractUses("- { name: flow, uses: owner/flow@v5 }"), ["owner/flow@v5"]);
  assert.deepEqual(extractUses("with: {uses: k/l@v6}"), ["k/l@v6"]);
  assert.deepEqual(extractUses("x: [uses: r/s@v1]"), ["r/s@v1"]);
  assert.deepEqual(extractUses("x: {a: [{uses: deep/n@v1}], uses: \"q/m@v2\"}"), [
    "deep/n@v1",
    "q/m@v2",
  ]);
  assert.deepEqual(extractUses("- {uses: *ref, name: z}"), ["*ref"]);
  assert.deepEqual(extractUses("- {uses: ${{ matrix.action }}}"), ["${{ matrix.action }}"]);
  assert.deepEqual(extractUses("- {name: a, # note\n   uses: o/c@v1}"), ["o/c@v1"]);
});

test("discoverActions surfaces alias and anchor declarations as unsupported or exact rows", () => {
  const rows = discoverActions(
    "ci.yml",
    "",
    "steps:\n  - uses: &co actions/checkout@v5\n  - uses: *co\n",
  );
  assert.deepEqual(rows.map((row) => [row.declaration, row.name, row.coverage]), [
    ["actions/checkout@v5", "actions/checkout", "unsupported"],
    ["*co", "*co", "unsupported"],
  ]);
});

test("empty registry versions object is present but lacks the current version", async () => {
  const metadata = {
    status: "ok",
    data: { versions: {}, time: {}, repository: "https://github.com/owner/repo" },
  };
  const result = await assess(npmRow(), fakeEvidence({ metadata }), cutoff);
  assert.deepEqual(result.current_evidence, {
    status: "unknown",
    reason: "Exact version absent from registry versions",
  });
  assert.equal(result.newer_stable_count, 0);
});

test("entrypoint guard runs the CLI when invoked through a symlink", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "skills-dependency-symlink-"));
  try {
    const target = fileURLToPath(
      new URL(
        "../../../dependabot-rollup/scripts/javascript/eligible-upgrades.mjs",
        import.meta.url,
      ),
    );
    const link = join(dir, "linked-upgrades.mjs");
    try {
      symlinkSync(realpathSync(target), link);
    } catch (error) {
      t.skip(`symlink unavailable: ${error.code}`);
      return;
    }
    const result = spawnSync(process.execPath, [link, "--invalid-option"], { encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Invalid argument --invalid-option/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
