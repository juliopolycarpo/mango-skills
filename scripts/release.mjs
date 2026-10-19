#!/usr/bin/env bun
/** Plan, draft and publish GitHub releases from main. Example: bun scripts/release.mjs plan --sha HEAD */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPackages, BUNDLE, validatePackages } from "./package-skills.mjs";
import { checkReleaseRecord, payloadDigest, planRelease, releaseRecord } from "./release-plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TAG = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;
const RECORD = "release.json";
const SUMS = "SHA256SUMS";
const USAGE = "plan --sha SHA | draft --sha SHA | publish --tag vX.Y.Z --sha SHA";
const describe = (value) => value === undefined ? "missing" : JSON.stringify(value);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const failure = (field, expected, received) =>
  new Error(`(${field}): expected ${expected} | received: ${received}`);

function spawn(command, args, { cwd, env, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw failure(command, "an installed command", result.error.message);
  return result;
}

function checked(command, args, options) {
  const result = spawn(command, args, options);
  if (result.status !== 0) {
    throw failure(
      `${command} ${args.join(" ")}`,
      "exit 0",
      `${result.status} ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

/**
 * Read commits, ancestry and committed trees from a local Git checkout.
 * Example: new GitRepo(".").messages(previousSha, "HEAD")
 */
export class GitRepo {
  constructor(cwd) {
    this.cwd = cwd;
  }

  /** Resolve REF to a full commit SHA. Example: git.head("HEAD") */
  head(ref) {
    const result = spawn("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd: this.cwd,
    });
    if (result.status !== 0) throw failure("git ref", "a commit", describe(ref));
    return result.stdout.trim();
  }

  /** Report whether ANCESTOR is DESCENDANT or one of its ancestors. Example: git.isAncestor(a, b) */
  isAncestor(ancestor, descendant) {
    const result = spawn("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: this.cwd,
    });
    if (result.status === 0) return true;
    if (result.status === 1) return false;
    throw failure(
      "git merge-base",
      `known commits ${ancestor} and ${descendant}`,
      result.stderr.trim(),
    );
  }

  /** List full commit messages reachable from TO but not FROM. Example: git.messages(a, b) */
  messages(from, to) {
    return checked("git", ["log", "--format=%B%x00", `${from}..${to}`], { cwd: this.cwd })
      .split("\0")
      .map((message) => message.trim())
      .filter(Boolean);
  }

  /**
   * Write the committed tree of SHA into the empty DIRECTORY without touching the checkout.
   * Example: git.exportTree(sha, mkdtempSync(join(tmpdir(), "tree-")))
   */
  exportTree(sha, directory) {
    const env = { GIT_INDEX_FILE: `${directory}.index` };
    try {
      checked("git", ["read-tree", sha], { cwd: this.cwd, env });
      checked("git", ["checkout-index", "--all", `--prefix=${directory}/`], { cwd: this.cwd, env });
    } finally {
      rmSync(env.GIT_INDEX_FILE, { force: true });
    }
  }
}

/**
 * Read and change GitHub releases, tags and Check runs through the gh CLI. GH_REPO or the
 * checkout's remote selects the repository; GH_TOKEN authorizes it.
 * Example: new GitHubReleases().releases().filter((release) => release.draft)
 */
export class GitHubReleases {
  constructor({ cwd, exec = spawn } = {}) {
    this.cwd = cwd;
    this.exec = exec;
  }

  gh(args) {
    const result = this.exec("gh", args, { cwd: this.cwd });
    if (result.status !== 0) {
      throw failure(`gh ${args.join(" ")}`, "exit 0", `${result.status} ${result.stderr.trim()}`);
    }
  }

  api(path, { method = "GET", body, paginate = false, missing } = {}) {
    const endpoint = path.startsWith("https://") ? path : `repos/{owner}/{repo}/${path}`;
    const args = ["api", "--method", method, endpoint];
    if (paginate) args.push("--paginate", "--slurp");
    if (body) args.push("--input", "-");
    const result = this.exec("gh", args, { cwd: this.cwd, input: body && JSON.stringify(body) });
    if (result.status !== 0) {
      if (missing !== undefined && /HTTP 404/.test(result.stderr)) return missing;
      throw failure(`gh api ${method} ${path}`, "a successful response", result.stderr.trim());
    }
    const text = result.stdout.trim();
    return text ? JSON.parse(text) : null;
  }

  /** List every release, drafts included. Example: github.releases() */
  releases() {
    return this.api("releases?per_page=100", { paginate: true }).flat();
  }

  /** Download TAG's assets, or only NAMES, into DIRECTORY. Example: github.downloadAssets("v0.1.0", dir) */
  downloadAssets(tag, directory, names = []) {
    const patterns = names.flatMap((name) => ["--pattern", name]);
    this.gh(["release", "download", tag, "--dir", directory, "--clobber", ...patterns]);
  }

  /** Create a release from API FIELDS. Example: github.createRelease({ tag_name, draft: true }) */
  createRelease(fields) {
    return this.api("releases", { method: "POST", body: fields });
  }

  /**
   * Change a draft release. Include tag_name: GitHub renames a draft to untagged-<hash> when an
   * edit omits it. Example: github.updateRelease(id, { tag_name: "v0.1.0", draft: false })
   */
  updateRelease(id, fields) {
    return this.api(`releases/${id}`, { method: "PATCH", body: fields });
  }

  /** Delete a draft release. Example: github.deleteRelease(id) */
  deleteRelease(id) {
    this.api(`releases/${id}`, { method: "DELETE" });
  }

  /** Delete one asset from a draft release. Example: github.deleteAsset(assetId) */
  deleteAsset(id) {
    this.api(`releases/assets/${id}`, { method: "DELETE" });
  }

  /**
   * Upload PATHS to a draft RELEASE that has no assets with those names. Uploads go by release id
   * rather than tag, so they reach this exact draft.
   * Example: github.uploadAssets(release, ["dist/SHA256SUMS"])
   */
  uploadAssets(release, paths) {
    const url = release.upload_url.replace(/\{.*\}$/, "");
    for (const path of paths) {
      this.gh([
        "api",
        "--method",
        "POST",
        `${url}?name=${encodeURIComponent(basename(path))}`,
        "--header",
        "Content-Type: application/octet-stream",
        "--input",
        path,
      ]);
    }
  }

  /** Generate GitHub's release notes for TAG at TARGET. Example: github.generateNotes({ tag, target, previousTag }) */
  generateNotes({ tag, target, previousTag }) {
    const body = { tag_name: tag, target_commitish: target };
    if (previousTag) body.previous_tag_name = previousTag;
    return this.api("releases/generate-notes", { method: "POST", body }).body;
  }

  /** Return TAG's ref object `{ type, sha }`, or null. Example: github.tagRef("v0.1.0") */
  tagRef(tag) {
    return this.api(`git/ref/tags/${tag}`, { missing: null })?.object ?? null;
  }

  /** Return an annotated tag object with its verification. Example: github.tagObject(sha) */
  tagObject(sha) {
    return this.api(`git/tags/${sha}`);
  }

  /** Report whether Check passed on a push to main at SHA. Example: github.checkPassed(sha) */
  checkPassed(sha) {
    const query = `head_sha=${sha}&status=success&event=push&branch=main&per_page=1`;
    return this.api(`actions/workflows/check.yml/runs?${query}`).total_count > 0;
  }

  /** Return BRANCH's current commit SHA. Example: github.branchHead("main") */
  branchHead(branch) {
    return this.api(`branches/${branch}`).commit.sha;
  }

  /** Return GitHub's compare status (ahead, identical, behind, diverged). Example: github.compare(sha, "main") */
  compare(base, head) {
    return this.api(`compare/${base}...${head}`).status;
  }
}

function parseArgs(args) {
  const [command, ...rest] = args;
  const usage = failure("command", USAGE, JSON.stringify(args));
  if (!["plan", "draft", "publish"].includes(command)) throw usage;
  const options = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const key = { "--sha": "sha", "--tag": "tag" }[rest[index]];
    if (!key || rest[index + 1] === undefined) throw usage;
    options[key] = rest[index + 1];
  }
  if (command === "publish" && !TAG.test(options.tag ?? "")) {
    throw failure("--tag", "vMAJOR.MINOR.PATCH", describe(options.tag));
  }
  if (!options.sha) throw failure("--sha", "a commit SHA or ref", "missing");
  return options;
}

function versionKey(tag) {
  return TAG.exec(tag)[1].split(".").map(Number);
}

function latestPublished(releases) {
  return releases
    .filter((release) => !release.draft && !release.prerelease && TAG.test(release.tag_name))
    .sort((a, b) => {
      const [left, right] = [versionKey(a.tag_name), versionKey(b.tag_name)];
      return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
    })[0] ?? null;
}

function readPrevious(github, release, scratch) {
  if (!release) return null;
  const directory = join(scratch, "previous");
  mkdirSync(directory, { recursive: true });
  github.downloadAssets(release.tag_name, directory, [RECORD]);
  const path = join(directory, RECORD);
  if (!existsSync(path)) throw failure(`${release.tag_name} ${RECORD}`, "a release asset", "none");
  const record = JSON.parse(readFileSync(path, "utf8"));
  checkReleaseRecord(record);
  if (`v${record.version}` !== release.tag_name) {
    throw failure(
      `${release.tag_name} ${RECORD} version`,
      release.tag_name.slice(1),
      record.version,
    );
  }
  return record;
}

function computePlan({ git, github, releases, sha, scratch }) {
  const latest = latestPublished(releases);
  const previous = readPrevious(github, latest, scratch);
  if (previous && !git.isAncestor(previous.sourceSha, sha)) {
    throw failure(
      "--sha",
      `a descendant of the ${latest.tag_name} source ${previous.sourceSha}`,
      sha,
    );
  }
  const tree = join(scratch, "tree");
  git.exportTree(sha, tree);
  const digest = payloadDigest(tree);
  const messages = previous ? git.messages(previous.sourceSha, sha) : [];
  return {
    plan: planRelease({ previous, digest, messages }),
    digest,
    tree,
    previousTag: latest?.tag_name ?? null,
  };
}

function summarize({ env, sha, plan, previousTag }) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  const skills = plan.changedSkills.map((skill) => `${skill.name} (${skill.change})`).join(", ");
  appendFileSync(
    env.GITHUB_STEP_SUMMARY,
    [
      `### Release plan for \`${sha}\``,
      "",
      `- Due: ${plan.due ? `yes, v${plan.version}` : "no"}`,
      `- Previous release: ${previousTag ?? "none"}`,
      `- Reason: ${plan.reason}`,
      `- Changed skills: ${skills || "none"}`,
      "",
    ].join("\n"),
  );
}

function build({ tree, out, version, sha, digest }) {
  const archives = buildPackages({ root: tree, version, out });
  const errors = validatePackages({ root: tree, version, out });
  if (errors.length) throw failure("packages", "valid archives", `\n${errors.join("\n")}`);
  const record = releaseRecord({ version, sourceSha: sha, digest, archives });
  writeFileSync(join(out, RECORD), `${JSON.stringify(record, null, 2)}\n`);
  const paths = [...archives.map((archive) => join(out, archive.file)), join(out, SUMS)];
  return { record, paths: [...paths, join(out, RECORD)] };
}

function notes({ github, plan, tag, sha, digest, previousTag, draft }) {
  const generated = github.generateNotes({ tag, target: sha, previousTag }).trim();
  const skills = plan.changedSkills.length
    ? plan.changedSkills.map((skill) => `${skill.name} (${skill.change})`).join(", ")
    : "none; packaged files outside skills changed";
  const lines = [
    generated,
    "",
    `**Changed skills:** ${skills}`,
    "",
    `**Source:** ${sha}`,
    "",
    `**Payload:** \`${digest.digest}\``,
  ];
  if (draft) {
    lines.push(
      "",
      "Publish this draft by pushing a signed tag on the source commit:",
      "",
      "```sh",
      `git tag -s ${tag} ${sha} -m "${BUNDLE} ${plan.version}" && git push origin ${tag}`,
      "```",
    );
  }
  return `${lines.join("\n")}\n`;
}

function upsertDraft({ github, releases, tag, sha, body, paths }) {
  const [current, ...duplicates] = releases.filter((release) =>
    release.draft && release.tag_name === tag
  );
  // Keep one draft per tag so publishing cannot pick a stale duplicate.
  for (const duplicate of duplicates) github.deleteRelease(duplicate.id);
  const release = current
    ? github.updateRelease(current.id, { tag_name: tag, target_commitish: sha, name: tag, body })
    : github.createRelease({ tag_name: tag, target_commitish: sha, name: tag, body, draft: true });
  // Clearing first makes a retry after a partial upload start from an empty draft.
  for (const asset of release.assets ?? []) github.deleteAsset(asset.id);
  github.uploadAssets(release, paths);
  return release;
}

function parseSums(text) {
  return new Map(
    text.trim().split("\n").filter(Boolean).map((line) => line.split(/ {2}/).reverse()),
  );
}

function verifyPublished({ github, tag, version, sha, scratch, expected }) {
  const release = github.releases().find((item) => item.tag_name === tag && !item.draft);
  if (!release) throw failure(tag, "a published release", "none");
  const directory = join(scratch, "published");
  mkdirSync(directory, { recursive: true });
  github.downloadAssets(tag, directory);
  const read = (name) => {
    const path = join(directory, name);
    return existsSync(path) ? readFileSync(path) : null;
  };
  const record = JSON.parse(read(RECORD) ?? "null");
  if (!record?.files) throw failure(`${tag} ${RECORD}`, "a release record with files", "none");
  const errors = [];
  const fail = (field, wanted, received) => errors.push(failure(field, wanted, received).message);
  if (record.version !== version) fail(`${RECORD} version`, version, describe(record.version));
  if (record.sourceSha !== sha) fail(`${RECORD} sourceSha`, sha, describe(record.sourceSha));
  if (expected && JSON.stringify(record) !== JSON.stringify(expected)) {
    fail(RECORD, "the record built by this run", "a different record");
  }
  const archives = Object.keys(record.files).sort();
  const wantedAssets = [...archives, SUMS, RECORD].sort().join(", ");
  const assets = release.assets.map((asset) => asset.name).sort().join(", ");
  if (assets !== wantedAssets) fail(`${tag} assets`, wantedAssets, assets);
  const sums = parseSums(read(SUMS)?.toString("utf8") ?? "");
  for (const name of archives) {
    const data = read(name);
    const actual = data ? sha256(data) : "missing";
    if (actual !== record.files[name]) fail(name, `sha256 ${record.files[name]}`, actual);
    if (sums.get(name) !== record.files[name]) {
      fail(`${SUMS} ${name}`, record.files[name], sums.get(name) ?? "missing");
    }
  }
  for (const name of sums.keys()) {
    if (!(name in record.files)) fail(SUMS, `only archives in ${RECORD}`, name);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return archives.length;
}

function verifyTag(github, tag, sha) {
  const fail = (expected, received) => {
    throw failure(`tag ${tag}`, expected, received);
  };
  const ref = github.tagRef(tag);
  if (!ref) fail("an existing tag", "none");
  if (ref.type !== "tag") {
    fail("an annotated signed tag (git tag -s)", `${ref.type} object ${ref.sha}`);
  }
  const object = github.tagObject(ref.sha);
  const { verified, reason } = object?.verification ?? {};
  if (verified !== true) {
    fail("a signature verified by GitHub", `verified=${verified} reason=${reason}`);
  }
  if (object.tag !== tag) fail(`a signature over the name ${tag}`, object.tag);
  if (object.object?.sha !== sha) fail(`to point at ${sha}`, object.object?.sha);
}

function draft({ git, github, sha, out, scratch, env, log }) {
  const mainHead = github.branchHead("main");
  if (sha !== mainHead) {
    log(`stale: ${sha} is not the main head ${mainHead}; the run for the newer head handles it`);
    return 0;
  }
  const releases = github.releases();
  const { plan, digest, tree, previousTag } = computePlan({ git, github, releases, sha, scratch });
  summarize({ env, sha, plan, previousTag });
  if (!plan.due) {
    log(`not due: ${plan.reason}`);
    return 0;
  }
  const tag = `v${plan.version}`;
  if (releases.some((release) => release.tag_name === tag && !release.draft)) {
    throw failure(tag, "an unpublished version", "a published release");
  }
  const { paths } = build({ tree, out, version: plan.version, sha, digest });
  // The release flow owns vX.Y.Z drafts; drafts for older plans were never published.
  for (const release of releases) {
    if (release.draft && TAG.test(release.tag_name) && release.tag_name !== tag) {
      github.deleteRelease(release.id);
    }
  }
  const body = notes({ github, plan, tag, sha, digest, previousTag, draft: true });
  upsertDraft({ github, releases, tag, sha, body, paths });
  log(`drafted ${tag} for ${sha}`);
  return 0;
}

function publish({ git, github, tag, sha, out, scratch, env, log }) {
  const version = TAG.exec(tag)[1];
  verifyTag(github, tag, sha);
  const status = github.compare(sha, "main");
  if (status !== "ahead" && status !== "identical") {
    throw failure("--sha", `a commit on main ${github.branchHead("main")}`, `${sha} (${status})`);
  }
  const releases = github.releases();
  if (releases.some((release) => release.tag_name === tag && !release.draft)) {
    const count = verifyPublished({ github, tag, version, sha, scratch });
    log(`${tag} is already published; verified ${count} archives`);
    return 0;
  }
  if (!github.checkPassed(sha)) {
    throw failure("Check", `a successful Check run on main for ${sha}`, "none");
  }
  const { plan, digest, tree, previousTag } = computePlan({ git, github, releases, sha, scratch });
  summarize({ env, sha, plan, previousTag });
  if (!plan.due) {
    throw failure("release plan", `a due release for ${tag}`, `not due: ${plan.reason}`);
  }
  if (plan.version !== version) {
    throw failure("tag version", `v${plan.version} from the release plan`, tag);
  }
  const { record, paths } = build({ tree, out, version, sha, digest });
  const body = notes({ github, plan, tag, sha, digest, previousTag, draft: false });
  const release = upsertDraft({ github, releases, tag, sha, body, paths });
  github.updateRelease(release.id, { tag_name: tag, draft: false, make_latest: "true" });
  const count = verifyPublished({ github, tag, version, sha, scratch, expected: record });
  log(`published ${tag} from ${sha}; verified ${count} archives`);
  return 0;
}

/**
 * Run a release command with injected Git and GitHub adapters; returns the exit code and throws
 * on invalid input or a failed check.
 * Example: main(["plan", "--sha", "HEAD"], { git: new GitRepo("."), github: new GitHubReleases() })
 */
export function main(args = [], {
  root = resolve(here, ".."),
  git = new GitRepo(root),
  github = new GitHubReleases({ cwd: root }),
  out = join(root, "dist"),
  env = process.env,
  log = console.log,
} = {}) {
  const options = parseArgs(args);
  const sha = git.head(options.sha);
  const scratch = mkdtempSync(join(tmpdir(), "mango-release-"));
  try {
    const context = { git, github, sha, out, scratch, env, log };
    if (options.command === "draft") return draft(context);
    if (options.command === "publish") return publish({ ...context, tag: options.tag });
    const releases = github.releases();
    const { plan, previousTag } = computePlan({ git, github, releases, sha, scratch });
    summarize({ env, sha, plan, previousTag });
    log(JSON.stringify({ sha, previous: previousTag, ...plan }, null, 2));
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
