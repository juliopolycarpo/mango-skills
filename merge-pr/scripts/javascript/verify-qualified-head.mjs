import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Checks that final branch/base refs match a qualification receipt and include the base.
 * Imported histories qualify the prepared merge candidate instead of passing this ancestry gate.
 * @example verifyQualifiedHead("/repo", "origin/main", "origin/umbrella", { head: headSha, base: baseSha })
 */
export function verifyQualifiedHead(repo, base, head, receipt) {
  function git(args) {
    const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(
        `(git ${args[0]}): expected exit 0 | received: ${result.status} ${result.stderr.trim()}`,
      );
    }
    return result.stdout.trim();
  }
  const baseSha = git(["rev-parse", "--verify", `${base}^{commit}`]);
  const headSha = git(["rev-parse", "--verify", `${head}^{commit}`]);
  if (receipt?.head !== headSha || receipt?.base !== baseSha) {
    throw new Error(
      `(qualification): expected head ${headSha}, base ${baseSha} | received: head ${receipt?.head}, base ${receipt?.base}`,
    );
  }
  git(["merge-base", "--is-ancestor", baseSha, headSha]);
  return { head: headSha, base: baseSha };
}

// Compare real paths: Node resolves symlinks in import.meta.url, and skills are symlinked.
const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  try {
    if (process.argv.length !== 7) {
      throw new Error(
        "Usage: bun verify-qualified-head.mjs <repo> <base-ref> <head-ref> <qualified-head-sha> <qualified-base-sha>",
      );
    }
    const [repo, base, head, qualifiedHead, qualifiedBase] = process.argv.slice(2);
    console.log(
      JSON.stringify(
        verifyQualifiedHead(repo, base, head, { head: qualifiedHead, base: qualifiedBase }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
