import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Exercise helper CLI entrypoints against synthetic Git history without external requests.
 * Example: bun scripts/smoke-helpers.mjs /path/to/new-artifacts
 */
function main() {
  assert(process.argv.length <= 3, "expected at most one artifact directory argument");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = process.argv[2]
    ? resolve(process.argv[2])
    : mkdtempSync(join(tmpdir(), "skill-cli-smoke-"));
  if (process.argv[2]) mkdirSync(output);
  const config = join(output, "fixture.gitconfig");
  writeFileSync(config, "");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" };
  const repo = join(output, "fixture");
  mkdirSync(repo);
  const results = [];
  function run(command, args, cwd = repo, expected = 0) {
    const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
    results.push({
      command,
      args,
      cwd,
      expected,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    assert.equal(
      result.status,
      expected,
      `${command} ${args.join(" ")}: expected exit ${expected}; received ${result.status}: ${
        result.error?.message ?? result.stderr
      }`,
    );
    return result.stdout.trim();
  }
  const git = (...args) => run("git", args);
  const cli = (path, args, expected = 0, cwd = repo) =>
    run(process.execPath, [join(root, path), ...args], cwd, expected);
  // Python ports mirror each JavaScript helper's arguments, output, and exit codes.
  const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const py = (path, args, expected = 0, cwd = repo) =>
    run(python, ["-I", join(root, path), ...args], cwd, expected);
  const helpers = {
    qualified: [
      "merge-pr/scripts/javascript/verify-qualified-head.mjs",
      "merge-pr/scripts/python/verify_qualified_head.py",
    ],
    deps: [
      "dependabot-rollup/scripts/javascript/eligible-upgrades.mjs",
      "dependabot-rollup/scripts/python/eligible_upgrades.py",
    ],
    squash: [
      "squash-pr/scripts/javascript/verify-squash.mjs",
      "squash-pr/scripts/python/verify_squash.py",
    ],
  };
  // The clock-derived cutoff is the only field allowed to differ between implementations.
  const comparable = (stdout) => {
    const { cutoff, ...rest } = JSON.parse(stdout);
    return rest;
  };
  const firstErrorLine = () => results.at(-1).stderr.split(/\r?\n/)[0];
  const both = (helper, args, expected = 0) => {
    const [js, pyPath] = helpers[helper];
    const output = cli(js, args, expected);
    const jsError = firstErrorLine();
    const pyOutput = py(pyPath, args, expected);
    if (output) {
      assert.deepEqual(comparable(pyOutput), comparable(output), `${helper}: Python stdout`);
    } else assert.equal(firstErrorLine(), jsError, `${helper}: Python stderr`);
    return output;
  };
  function commit(message, parents = []) {
    const sha = git(
      "commit-tree",
      git("write-tree"),
      ...parents.flatMap(parent => ["-p", parent]),
      "-m",
      message,
    );
    git("update-ref", "HEAD", sha);
    return sha;
  }
  try {
    git("init", "-qb", "main");
    git("config", "user.name", "Smoke Fixture");
    git("config", "user.email", "fixture@example.test");
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ dependencies: { fixture: "^0.0.1" } }),
    );
    writeFileSync(join(repo, "obsolete.txt"), "obsolete\n");
    git("add", ".");
    const base = commit("base fixture");
    git("checkout", "-qb", "feature");
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ dependencies: { fixture: "^1.2.3" } }),
    );
    writeFileSync(join(repo, "feature.txt"), "feature\n");
    git("rm", "obsolete.txt");
    git("add", ".");
    const head = commit("feature fixture", [base]);
    const qualified = JSON.parse(
      both("qualified", [
        repo,
        "main",
        "feature",
        head,
        base,
      ]),
    );
    assert.equal(qualified.head, head);
    both("qualified", [
      repo,
      "main",
      "feature",
      base,
      base,
    ], 1);
    const deps = JSON.parse(
      both("deps", [
        "--base",
        base,
        "--head",
        head,
        "--json",
      ], 2),
    );
    assert.equal(deps.head, head);
    assert.equal(deps.rows.length, 1);
    assert.equal(deps.rows[0].declaration, "^1.2.3");
    assert.equal(deps.rows[0].current_evidence.status, "unknown");
    git("checkout", "main");
    git("read-tree", `${head}^{tree}`);
    const squash = commit("squash fixture", [base]);
    const integration = JSON.parse(
      both("squash", [repo, head, squash, "main"]),
    );
    assert.equal(integration.merge, squash);
    both("squash", [repo, head, base, "main"], 1);
    const validation = JSON.parse(cli("scripts/validate-skills.mjs", [root, "--json"]));
    assert(validation.skills > 0);
    assert.deepEqual(validation.errors, []);
    for (
      const path of [
        "merge-pr/scripts/javascript/verify-qualified-head.mjs",
        "squash-pr/scripts/javascript/verify-squash.mjs",
        "scripts/validate-skills.mjs",
        "dependabot-rollup/scripts/javascript/eligible-upgrades.mjs",
      ]
    ) cli(path, ["--invalid-option"], 1);
    for (const [, path] of Object.values(helpers)) py(path, ["--invalid-option"], 1);
    console.log(JSON.stringify({ status: "passed", output, commands: results.length }));
  } finally {
    writeFileSync(join(output, "smoke-results.json"), JSON.stringify(results, null, 2) + "\n");
  }
}

main();
