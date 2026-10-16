import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyQualifiedHead } from "./verify-qualified-head.mjs";

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

test("requires final qualification after merging base while retaining original commits", () => {
  const f = fixture();
  f.git("checkout", "feature");
  f.git("merge", "--no-ff", "-m", "chore: integrate base", f.base);
  const final = f.git("rev-parse", "HEAD");
  assert.throws(
    () => verifyQualifiedHead(f.repo, "main", "feature", { head: f.head, base: f.base }),
    /qualification/,
  );
  assert.equal(
    verifyQualifiedHead(f.repo, "main", "feature", { head: final, base: f.base }).head,
    final,
  );
  f.git("merge-base", "--is-ancestor", f.head, final);
  f.commit("new-head");
  assert.throws(
    () => verifyQualifiedHead(f.repo, "main", "feature", { head: final, base: f.base }),
    /qualification/,
  );
});

test("rejects stale base receipts and unintegrated base", () => {
  const f = fixture();
  assert.throws(
    () => verifyQualifiedHead(f.repo, "main", "feature", { head: f.head, base: f.initial }),
    /qualification/,
  );
  assert.throws(
    () => verifyQualifiedHead(f.repo, "main", "feature", { head: f.head, base: f.base }),
    /expected exit 0/,
  );
});

test("runs its CLI through a symlinked skill path", () => {
  const scripts = [
    new URL("./verify-qualified-head.mjs", import.meta.url),
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
