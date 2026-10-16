import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

function git(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `(git ${args[0]}): expected exit 0 | received: ${result.status} ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

/** Verifies the PR's actual squash against integration with its actual first parent.
 * @example verifySquash("/repo", reviewedHead, mergeCommit, fetchedBase)
 */
export function verifySquash(repo, head, merge, base) {
  const resolve = (ref) => git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]);
  const headSha = resolve(head);
  const mergeSha = resolve(merge);
  const baseSha = resolve(base);
  const parents = git(repo, ["show", "-s", "--format=%P", mergeSha]).split(" ").filter(Boolean);
  if (parents.length !== 1) {
    throw new Error(`(squash parents): expected 1 | received: ${parents.length}`);
  }
  git(repo, ["merge-base", "--is-ancestor", mergeSha, baseSha]);
  const expectedTree =
    git(repo, ["merge-tree", "--write-tree", parents[0], headSha]).split("\n")[0];
  const actualTree = git(repo, ["rev-parse", `${mergeSha}^{tree}`]);
  if (actualTree !== expectedTree) {
    throw new Error(`(squash tree): expected ${expectedTree} | received: ${actualTree}`);
  }
  return { head: headSha, merge: mergeSha, parent: parents[0], base: baseSha, tree: actualTree };
}

// Compare real paths: Node resolves symlinks in import.meta.url, and skills are symlinked.
const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  try {
    if (process.argv.length !== 6) {
      throw new Error(
        "Usage: bun verify-squash.mjs <repo> <reviewed-head> <actual-merge-sha> <fetched-base>",
      );
    }
    console.log(JSON.stringify(verifySquash(...process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
