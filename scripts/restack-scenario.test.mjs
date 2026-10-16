import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(cwd, args, env = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(cwd, "fixture-global-config"),
      GIT_CONFIG_NOSYSTEM: "1",
      ...env,
    },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function withRepository(inspect) {
  const root = mkdtempSync(join(tmpdir(), "fix-published-skill-review-workflows-"));
  try {
    git(root, ["init", "-b", "main"]);
    git(root, ["config", "user.name", "Workflow fixture"]);
    git(root, ["config", "user.email", "workflow@example.invalid"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    writeFileSync(join(root, "base.txt"), "base\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "base"]);
    inspect(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("documented restack excludes parent work removed during parent review", () => {
  withRepository((root) => {
    const base = git(root, ["rev-parse", "HEAD"]);
    git(root, ["switch", "-c", "parent"]);
    writeFileSync(join(root, "discarded-parent.txt"), "discarded\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "original parent"]);
    const oldFeatureBase = git(root, ["rev-parse", "HEAD"]);
    git(root, ["switch", "-c", "child"]);
    writeFileSync(join(root, "child.txt"), "child\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "child feature"]);
    const oldHead = git(root, ["rev-parse", "HEAD"]);
    git(root, ["switch", "parent"]);
    git(root, ["reset", "--hard", base]);
    writeFileSync(join(root, "reviewed-parent.txt"), "reviewed\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "reviewed parent"]);
    const parentHead = git(root, ["rev-parse", "HEAD"]);
    git(root, ["switch", "main"]);
    git(root, ["merge", "--squash", "parent"]);
    git(root, ["commit", "-m", "squash parent"]);
    git(root, ["switch", "child"]);
    const reference = readFileSync(
      new URL("../rebase-pr/references/replay.md", import.meta.url),
      "utf8",
    );
    const command = reference.match(/git rebase --onto "([^"\n]+)" "([^"\n]+)"/);
    expect(command).not.toBeNull();
    const refs = { $base_ref: "main", $parent_head: parentHead, $old_feature_base: oldFeatureBase };
    git(root, ["rebase", "--onto", refs[command[1]], refs[command[2]]]);
    expect(git(root, ["ls-tree", "--name-only", "HEAD"])).toBe(
      "base.txt\nchild.txt\nreviewed-parent.txt",
    );
    expect(git(root, ["rev-list", "--count", "main..HEAD"])).toBe("1");
    const comparison = git(root, ["range-diff", `${oldFeatureBase}..${oldHead}`, "main..HEAD"]);
    expect(comparison).toContain("= 1:");
  });
});
