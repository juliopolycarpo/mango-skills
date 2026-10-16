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

test("documented orphan recovery uses surviving metadata and leaves the original index intact", () => {
  withRepository((root) => {
    writeFileSync(join(root, "obsolete.txt"), "remove this\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "tracked deletion fixture"]);
    const orphan = mkdtempSync(join(tmpdir(), "fix-published-skill-review-orphan-"));
    const scratch = mkdtempSync(join(tmpdir(), "fix-published-skill-review-recovery-"));
    try {
      writeFileSync(join(orphan, "base.txt"), "recovered edit\n");
      writeFileSync(join(orphan, "new.txt"), "recovered addition\n");
      const originalIndex = git(root, ["write-tree"]);
      const baseRef = git(root, ["rev-parse", "HEAD"]);
      const legacy = spawnSync("git", ["read-tree", baseRef], {
        cwd: orphan,
        encoding: "utf8",
        env: { ...process.env, GIT_INDEX_FILE: join(scratch, "legacy.index") },
      });
      expect(legacy.status).not.toBe(0);
      expect(legacy.stderr).toContain("not a git repository");
      const env = {
        GIT_DIR: git(root, ["rev-parse", "--absolute-git-dir"]),
        GIT_WORK_TREE: orphan,
        GIT_INDEX_FILE: join(scratch, "recovery.index"),
      };
      const document = readFileSync(
        new URL("../deliver-pr-wave/references/coordination.md", import.meta.url),
        "utf8",
      );
      const block = document.match(/```bash\n([\s\S]*?)\n```/)[1];
      expect(block).toContain("export GIT_DIR=\"$surviving_git_dir\"");
      expect(block).toContain("export GIT_WORK_TREE=\"$orphaned_worktree\"");
      expect(block).toContain("export GIT_INDEX_FILE=\"$branch_scratch_dir/recovery.index\"");
      const commands = block.split("\n").map((line) => line.trim()).filter((line) =>
        line.startsWith("git ")
      );
      expect(commands).toHaveLength(3);
      let patch = "";
      for (const command of commands) {
        const args = command.replace(/\s*&&$/, "").split(" > ")[0].match(/"[^"]*"|[^\s]+/g)
          .slice(1).map((argument) => argument.replaceAll("\"", "").replace("$base_ref", baseRef));
        patch = git(orphan, args, env);
      }
      expect(patch).toContain("+recovered edit");
      expect(patch).toContain("+recovered addition");
      expect(patch).toContain("deleted file mode");
      expect(patch).toContain("obsolete.txt");
      expect(git(root, ["write-tree"])).toBe(originalIndex);
      expect(git(root, ["diff", "--cached", "--stat"])).toBe("");
    } finally {
      rmSync(orphan, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
