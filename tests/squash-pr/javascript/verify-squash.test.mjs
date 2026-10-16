import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifySquash } from "../../../squash-pr/scripts/javascript/verify-squash.mjs";

const roots = [];
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "skills-fix-landing-"));
  roots.push(repo);
  function git(...args) {
    const result = spawnSync("git", [
      "-C",
      repo,
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      ...args,
    ], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Fixture git ${args[0]}: ${result.stderr}`);
    return result.stdout.trim();
  }
  function commit(name) {
    writeFileSync(join(repo, name), name);
    git("add", name);
    git("commit", "-qm", `test: ${name}`);
    return git("rev-parse", "HEAD");
  }
  git("init", "-qb", "main");
  const initial = commit("initial");
  git("checkout", "-qb", "feature");
  const head = commit("feature");
  git("checkout", "main");
  const base = commit("advanced-base");
  return { repo, git, commit, initial, head, base };
}
after(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

test("verifies actual squash after independent base changes and a later landing", () => {
  const f = fixture();
  f.git("merge", "--squash", f.head);
  f.git("commit", "-qm", "feat: squash");
  const merge = f.git("rev-parse", "HEAD");
  const later = f.commit("later-landing");
  assert.notEqual(f.git("rev-parse", `${f.head}^{tree}`), f.git("rev-parse", `${merge}^{tree}`));
  assert.equal(verifySquash(f.repo, f.head, merge, later).merge, merge);
  assert.throws(() => verifySquash(f.repo, f.head, later, later), /squash tree/);
  assert.throws(() => verifySquash(f.repo, f.head, merge, f.base), /expected exit 0/);
});

test("rejects a squash missing reviewed content", () => {
  const f = fixture();
  const wrong = f.commit("wrong-content");
  assert.throws(() => verifySquash(f.repo, f.head, wrong, wrong), /squash tree/);
});

test("runs its CLI through a symlinked skill path", () => {
  const scripts = [
    new URL("../../../squash-pr/scripts/javascript/verify-squash.mjs", import.meta.url),
  ];
  for (const script of scripts) {
    const dir = mkdtempSync(join(tmpdir(), "skills-fix-link-"));
    roots.push(dir);
    const link = join(dir, "linked.mjs");
    symlinkSync(fileURLToPath(script), link);
    const result = spawnSync(process.execPath, [link], { encoding: "utf8" });
    assert.equal(result.status, 1, `${link}: expected exit 1 | received: ${result.status}`);
    assert.match(result.stderr, /^Usage: /);
  }
});
