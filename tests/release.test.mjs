import { expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { GitHubReleases, GitRepo, main } from "../scripts/release.mjs";

const svg =
  "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><title>Icon</title><path d=\"M0 0\"/></svg>";
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
// Each case builds archives and runs Git several times; Windows runners exceed the 5 s default.
setDefaultTimeout(30_000);

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

/** In-memory GitHub Releases with the GitHubReleases interface; published releases are immutable. */
class FakeGitHub {
  constructor(git) {
    this.git = git;
    this.list = [];
    this.nextId = 1;
    this.tags = new Map();
    this.passed = new Set();
    this.main = null;
    this.failUploads = 0;
    this.mutations = 0;
    this.notesRequests = [];
  }
  find(tag) {
    return this.list.find((release) => release.tag_name === tag);
  }
  mutable(release) {
    this.mutations++;
    if (!release) throw new Error("fake: release not found");
    if (!release.draft) throw new Error(`fake: ${release.tag_name} is published and immutable`);
    return release;
  }
  seedDraft(tag, assetNames = []) {
    const release = this.createRelease({ tag_name: tag, name: tag, body: "", draft: true });
    for (const name of assetNames) {
      release.assets.push({ id: this.nextId++, name, data: Buffer.from(name) });
    }
    return release;
  }
  signTag(tag, commit, { type = "tag", verified = true, reason = "valid", name = tag } = {}) {
    const object = sha256(`tag ${tag}`).slice(0, 40);
    this.tags.set(tag, {
      ref: { type, sha: type === "tag" ? object : commit },
      object: {
        tag: name,
        object: { type: "commit", sha: commit },
        verification: { verified, reason },
      },
    });
  }
  releases() {
    return this.list.map((release) => ({
      ...release,
      assets: release.assets.map(({ id, name }) => ({ id, name })),
    }));
  }
  downloadAssets(tag, directory, names) {
    for (const asset of this.find(tag)?.assets ?? []) {
      if (!names || names.includes(asset.name)) {
        writeFileSync(join(directory, asset.name), asset.data);
      }
    }
  }
  createRelease(fields) {
    this.mutations++;
    const release = { id: this.nextId++, prerelease: false, assets: [], ...fields };
    this.list.push(release);
    return { ...release };
  }
  updateRelease(id, fields) {
    const release = this.mutable(this.list.find((item) => item.id === id));
    const { make_latest: _, ...rest } = fields;
    // GitHub renames a draft to untagged-<hash> when an edit omits tag_name.
    if (!("tag_name" in rest)) rest.tag_name = `untagged-${sha256(String(id)).slice(0, 20)}`;
    Object.assign(release, rest);
    return { ...release };
  }
  deleteRelease(id) {
    this.mutable(this.list.find((item) => item.id === id));
    this.list = this.list.filter((item) => item.id !== id);
  }
  deleteAsset(id) {
    const release = this.list.find((item) => item.assets.some((asset) => asset.id === id));
    this.mutable(release).assets = release.assets.filter((asset) => asset.id !== id);
  }
  uploadAssets(target, paths) {
    const release = this.mutable(this.list.find((item) => item.id === target.id));
    for (const path of paths) {
      if (this.failUploads > 0 && path !== paths[0]) {
        this.failUploads--;
        throw new Error(`fake: upload of ${basename(path)} failed: connection reset`);
      }
      if (release.assets.some((asset) => asset.name === basename(path))) {
        throw new Error(`fake: asset ${basename(path)} already_exists`);
      }
      release.assets.push({ id: this.nextId++, name: basename(path), data: readFileSync(path) });
    }
  }
  generateNotes(request) {
    this.notesRequests.push(request);
    return "## What's Changed\n* fixture change by @owner";
  }
  tagRef(tag) {
    return this.tags.get(tag)?.ref ?? null;
  }
  tagObject(sha) {
    return [...this.tags.values()].find((entry) => entry.ref.sha === sha)?.object ?? null;
  }
  checkPassed(sha) {
    return this.passed.has(sha);
  }
  branchHead(branch) {
    if (branch !== "main") throw new Error(`fake: unexpected branch ${branch}`);
    return this.main;
  }
  compare(base, head) {
    const target = head === "main" ? this.main : head;
    if (base === target) return "identical";
    return this.git.isAncestor(base, target) ? "ahead" : "diverged";
  }
}

function withRepository(inspect) {
  const root = mkdtempSync(join(tmpdir(), "release-repo-"));
  const out = mkdtempSync(join(tmpdir(), "release-out-"));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(out, "fixture-global-config"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const run = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (files) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  };
  const commit = (files, message) => {
    write(files);
    run(["add", "-A"]);
    run(["commit", "-m", message]);
    return run(["rev-parse", "HEAD"]);
  };
  try {
    run(["init", "-b", "main"]);
    run(["config", "user.name", "Release fixture"]);
    run(["config", "user.email", "release@example.invalid"]);
    run(["config", "commit.gpgsign", "false"]);
    const first = commit({
      LICENSE: "MIT License\n",
      "assets/mango-skills.svg": svg,
      "tests/alpha.test.mjs": "// test\n",
      ...skill("alpha"),
      ...skill("beta"),
    }, "feat: add fixture skills");
    const git = new GitRepo(root);
    const github = new FakeGitHub(git);
    github.main = first;
    const logs = [];
    const release = (args, extra = {}) =>
      main(args, { git, github, root, out, env: {}, log: (line) => logs.push(line), ...extra });
    const publishFirst = () => {
      github.main = run(["rev-parse", "HEAD"]);
      github.signTag("v0.1.0", github.main);
      github.passed.add(github.main);
      expect(release(["publish", "--tag", "v0.1.0", "--sha", github.main])).toBe(0);
      return github.main;
    };
    inspect({ root, git, github, run, write, commit, first, logs, release, publishFirst });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
}

const assetNames = (release, version) =>
  [
    `mango-alpha-${version}.zip`,
    `mango-beta-${version}.zip`,
    `mango-skills-${version}.zip`,
    "SHA256SUMS",
    "release.json",
  ].sort().toString() === release.assets.map((asset) => asset.name).sort().toString();
const record = (github, tag) =>
  JSON.parse(github.find(tag).assets.find((asset) => asset.name === "release.json").data);

test("a candidate for a commit that is no longer the main head does nothing", () => {
  withRepository(({ github, commit, first, logs, release }) => {
    github.main = commit({ "alpha/references/guide.md": "# Newer\n" }, "docs(alpha): newer");
    expect(release(["draft", "--sha", first])).toBe(0);
    expect(github.mutations).toBe(0);
    expect(logs.join("\n")).toContain(`stale: ${first} is not the main head ${github.main}`);
  });
});

test("the first candidate drafts v0.1.0 with archives, checksums, record and tag command", () => {
  withRepository(({ github, first, release }) => {
    expect(release(["draft", "--sha", "HEAD"])).toBe(0);
    const draft = github.find("v0.1.0");
    expect(draft).toMatchObject({ draft: true, target_commitish: first, name: "v0.1.0" });
    expect(assetNames(draft, "0.1.0")).toBe(true);
    expect(record(github, "v0.1.0")).toMatchObject({ version: "0.1.0", sourceSha: first });
    expect(draft.body).toContain("* fixture change by @owner");
    expect(draft.body).toContain("alpha (added), beta (added)");
    expect(draft.body).toContain(
      `git tag -s v0.1.0 ${first} -m "mango-skills 0.1.0" && git push origin v0.1.0`,
    );
    expect(github.notesRequests).toEqual([{ tag: "v0.1.0", target: first, previousTag: null }]);
  });
});

test("a candidate reuses its version's draft, prunes stale assets and deletes other drafts", () => {
  withRepository(({ github, first, release }) => {
    const reused = github.seedDraft("v0.1.0", ["mango-gone-0.1.0.zip", "SHA256SUMS"]);
    github.seedDraft("v0.0.9");
    github.seedDraft("v0.1.0", ["SHA256SUMS"]);
    github.seedDraft("announcement");
    expect(release(["draft", "--sha", first])).toBe(0);
    expect(github.list.map((item) => item.tag_name).sort()).toEqual(["announcement", "v0.1.0"]);
    expect(github.find("v0.1.0").id).toBe(reused.id);
    expect(assetNames(github.find("v0.1.0"), "0.1.0")).toBe(true);
  });
});

test("a candidate whose payload has not changed leaves pending drafts alone", () => {
  withRepository(({ github, commit, logs, release, publishFirst }) => {
    publishFirst();
    const pending = github.seedDraft("v0.1.1", ["SHA256SUMS"]);
    github.main = commit({ "tests/alpha.test.mjs": "// changed\n" }, "test: cover alpha");
    const mutations = github.mutations;
    expect(release(["draft", "--sha", github.main])).toBe(0);
    expect(github.mutations).toBe(mutations);
    expect(github.find("v0.1.1")).toEqual(pending);
    expect(logs.join("\n")).toContain("not due: payload unchanged since v0.1.0");
  });
});

test("a breaking change after a release drafts the next minor against the previous tag", () => {
  withRepository(({ github, commit, release, publishFirst }) => {
    publishFirst();
    github.main = commit({
      "alpha/SKILL.md": "---\nname: alpha\ndescription: Use when.\n---\n# A\n",
    }, "feat(alpha)!: rename the entry point");
    expect(release(["draft", "--sha", github.main])).toBe(0);
    const draft = github.find("v0.2.0");
    expect(draft).toMatchObject({ draft: true, target_commitish: github.main });
    expect(draft.body).toContain("alpha (changed)");
    expect(github.notesRequests.at(-1)).toEqual({
      tag: "v0.2.0",
      target: github.main,
      previousTag: "v0.1.0",
    });
  });
});

test("a candidate that does not descend from the last release fails naming both commits", () => {
  withRepository(({ github, run, commit, first, release }) => {
    commit({ "alpha/references/guide.md": "# Released\n" }, "docs(alpha): released");
    github.main = run(["rev-parse", "HEAD"]);
    github.signTag("v0.1.0", github.main);
    github.passed.add(github.main);
    expect(release(["publish", "--tag", "v0.1.0", "--sha", github.main])).toBe(0);
    const released = github.main;
    run(["switch", "-c", "side", first]);
    github.main = commit({ "beta/references/guide.md": "# Side\n" }, "docs(beta): side");
    expect(() => release(["draft", "--sha", github.main])).toThrow(
      `(--sha): expected a descendant of the v0.1.0 source ${released} | received: ${github.main}`,
    );
  });
});

test("publishing rejects tags that are not signed annotated tags over the commit", () => {
  withRepository(({ github, commit, first, release }) => {
    github.passed.add(first);
    const publish = () => release(["publish", "--tag", "v0.1.0", "--sha", first]);
    expect(publish).toThrow("(tag v0.1.0): expected an existing tag | received: none");
    github.signTag("v0.1.0", first, { type: "commit" });
    expect(publish).toThrow(
      `(tag v0.1.0): expected an annotated signed tag (git tag -s) | received: commit object ${first}`,
    );
    github.signTag("v0.1.0", first, { verified: false, reason: "unsigned" });
    expect(publish).toThrow(
      "(tag v0.1.0): expected a signature verified by GitHub | received: verified=false reason=unsigned",
    );
    github.signTag("v0.1.0", first, { name: "v9.9.9" });
    expect(publish).toThrow(
      "(tag v0.1.0): expected a signature over the name v0.1.0 | received: v9.9.9",
    );
    const other = commit({ "README.md": "# Later\n" }, "docs: later");
    github.signTag("v0.1.0", other);
    expect(publish).toThrow(`(tag v0.1.0): expected to point at ${first} | received: ${other}`);
    expect(github.mutations).toBe(0);
  });
});

test("publishing rejects a tag commit that is not on main", () => {
  withRepository(({ github, run, commit, first, release }) => {
    run(["switch", "-c", "side"]);
    const side = commit({ "alpha/references/guide.md": "# Side\n" }, "docs(alpha): side");
    github.signTag("v0.1.0", side);
    github.passed.add(side);
    expect(() => release(["publish", "--tag", "v0.1.0", "--sha", side])).toThrow(
      `(--sha): expected a commit on main ${first} | received: ${side} (diverged)`,
    );
  });
});

test("publishing a tag whose version differs from the plan fails", () => {
  withRepository(({ github, first, release }) => {
    github.signTag("v0.2.0", first);
    github.passed.add(first);
    expect(() => release(["publish", "--tag", "v0.2.0", "--sha", first])).toThrow(
      "(tag version): expected v0.1.0 from the release plan | received: v0.2.0",
    );
    expect(github.mutations).toBe(0);
  });
});

test("publishing without a successful Check run fails", () => {
  withRepository(({ github, first, release }) => {
    github.signTag("v0.1.0", first);
    expect(() => release(["publish", "--tag", "v0.1.0", "--sha", first])).toThrow(
      `(Check): expected a successful Check run on main for ${first} | received: none`,
    );
    expect(github.mutations).toBe(0);
  });
});

test("a publish retry after a failed upload reuses the draft and finishes", () => {
  withRepository(({ github, first, release }) => {
    github.signTag("v0.1.0", first);
    github.passed.add(first);
    github.failUploads = 1;
    const publish = () => release(["publish", "--tag", "v0.1.0", "--sha", first]);
    expect(publish).toThrow("fake: upload of");
    const draft = github.find("v0.1.0");
    expect(draft.draft).toBe(true);
    expect(publish()).toBe(0);
    expect(github.list).toHaveLength(1);
    expect(github.find("v0.1.0")).toMatchObject({
      id: draft.id,
      draft: false,
      target_commitish: first,
    });
    expect(assetNames(github.find("v0.1.0"), "0.1.0")).toBe(true);
    expect(github.find("v0.1.0").body).not.toContain("git tag -s");
  });
});

test("rerunning publish for a published release only verifies it", () => {
  withRepository(({ github, logs, release, publishFirst }) => {
    const source = publishFirst();
    const mutations = github.mutations;
    expect(release(["publish", "--tag", "v0.1.0", "--sha", source])).toBe(0);
    expect(github.mutations).toBe(mutations);
    expect(logs.join("\n")).toContain("v0.1.0 is already published; verified 3 archives");
  });
});

test("a published asset whose hash differs from the record fails verification", () => {
  withRepository(({ github, release, publishFirst }) => {
    const source = publishFirst();
    const asset = github.find("v0.1.0").assets.find((item) =>
      item.name === "mango-alpha-0.1.0.zip"
    );
    asset.data = Buffer.from("tampered");
    expect(() => release(["publish", "--tag", "v0.1.0", "--sha", source])).toThrow(
      `(mango-alpha-0.1.0.zip): expected sha256 ${
        record(github, "v0.1.0").files["mango-alpha-0.1.0.zip"]
      } | received: ${sha256("tampered")}`,
    );
  });
});

test("plan reads the committed tree and reports to the step summary without writing releases", () => {
  withRepository(({ github, root, write, logs, release, publishFirst }) => {
    publishFirst();
    write({ "alpha/references/guide.md": "# Uncommitted\n" });
    const summary = join(root, "..", `${basename(root)}-summary.md`);
    try {
      const mutations = github.mutations;
      expect(release(["plan", "--sha", "HEAD"], { env: { GITHUB_STEP_SUMMARY: summary } })).toBe(0);
      expect(github.mutations).toBe(mutations);
      expect(JSON.parse(logs.at(-1))).toMatchObject({ due: false, previous: "v0.1.0" });
      expect(readFileSync(summary, "utf8")).toContain("payload unchanged since v0.1.0");
    } finally {
      rmSync(summary, { force: true });
    }
  });
});

test("unknown commands and missing options name the expected usage", () => {
  withRepository(({ release }) => {
    expect(() => release(["ship"])).toThrow(
      "(command): expected plan --sha SHA | draft --sha SHA | publish --tag vX.Y.Z --sha SHA | received: [\"ship\"]",
    );
    expect(() => release(["publish", "--sha", "HEAD"])).toThrow(
      "(--tag): expected vMAJOR.MINOR.PATCH | received: missing",
    );
  });
});

test("GitRepo reads messages and ancestry from the repository", () => {
  withRepository(({ git, commit, first }) => {
    const second = commit({ "README.md": "# Two\n" }, "fix: two\n\nBREAKING CHANGE: body");
    expect(git.head("HEAD")).toBe(second);
    expect(git.messages(first, second)).toEqual(["fix: two\n\nBREAKING CHANGE: body"]);
    expect(git.isAncestor(first, second)).toBe(true);
    expect(git.isAncestor(second, first)).toBe(false);
    expect(() => git.head("missing-ref")).toThrow(
      "(git ref): expected a commit | received: \"missing-ref\"",
    );
  });
});

/** Records gh invocations and answers each with an empty successful response. */
class RecordingGh {
  constructor() {
    this.calls = [];
  }
  run(command, args) {
    this.calls.push([command, ...args].join(" "));
    return { status: 0, stdout: "", stderr: "" };
  }
}

test("GitHubReleases uploads to a draft by release id", () => {
  const gh = new RecordingGh();
  const github = new GitHubReleases({ exec: (...args) => gh.run(...args) });
  const upload = "https://uploads.github.com/repos/o/r/releases/7/assets";
  github.uploadAssets(
    { id: 7, upload_url: `${upload}{?name,label}`, assets: [] },
    [join("dist", "SHA256SUMS"), join("dist", "release.json")],
  );
  expect(gh.calls).toEqual([
    `gh api --method POST ${upload}?name=SHA256SUMS --header Content-Type: application/octet-stream --input ${
      join("dist", "SHA256SUMS")
    }`,
    `gh api --method POST ${upload}?name=release.json --header Content-Type: application/octet-stream --input ${
      join("dist", "release.json")
    }`,
  ]);
});
