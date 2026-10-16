"""Verify a PR's actual squash commit against its reviewed head."""

from __future__ import annotations

import json
import subprocess
import sys

USAGE = (
    "Usage: python3 verify_squash.py <repo> <reviewed-head> <actual-merge-sha> <fetched-base>"
)


def _git(repo: str, args: list[str]) -> str:
    """Run `git -C repo args` and return trimmed stdout.

    Raises RuntimeError as `(git <subcommand>): expected exit 0 | received: <status> <stderr>`.

    Example: _git("/repo", ["rev-parse", "HEAD"])
    """
    result = subprocess.run(
        ["git", "-C", repo, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"(git {args[0]}): expected exit 0 | received: "
            f"{result.returncode} {result.stderr.strip()}"
        )
    return result.stdout.strip()


def verify_squash(repo: str, head: str, merge: str, base: str) -> dict[str, str]:
    """Verify the PR's actual squash against integration with its actual first parent.

    Resolves the refs, requires a single-parent merge commit reachable from base, and
    requires its tree to equal the merge-tree of that parent and the reviewed head.
    Returns `{head, merge, parent, base, tree}`; raises RuntimeError on failure.

    Example: verify_squash("/repo", reviewed_head, merge_commit, fetched_base)
    """

    def resolve(ref: str) -> str:
        return _git(repo, ["rev-parse", "--verify", f"{ref}^{{commit}}"])

    head_sha = resolve(head)
    merge_sha = resolve(merge)
    base_sha = resolve(base)
    parents = _git(repo, ["show", "-s", "--format=%P", merge_sha]).split()
    if len(parents) != 1:
        raise RuntimeError(f"(squash parents): expected 1 | received: {len(parents)}")
    _git(repo, ["merge-base", "--is-ancestor", merge_sha, base_sha])
    expected_tree = _git(
        repo, ["merge-tree", "--write-tree", parents[0], head_sha]
    ).split("\n")[0]
    actual_tree = _git(repo, ["rev-parse", f"{merge_sha}^{{tree}}"])
    if actual_tree != expected_tree:
        raise RuntimeError(
            f"(squash tree): expected {expected_tree} | received: {actual_tree}"
        )
    return {
        "head": head_sha,
        "merge": merge_sha,
        "parent": parents[0],
        "base": base_sha,
        "tree": actual_tree,
    }


def main(argv: list[str] | None = None) -> int:
    """Run the CLI and return the process exit code (0 success, 1 failure).

    Example: main(["/repo", reviewed_head, merge_sha, "origin/main"])
    """
    args = sys.argv[1:] if argv is None else argv
    try:
        if len(args) != 4:
            raise RuntimeError(USAGE)
        print(json.dumps(verify_squash(*args), indent=2))
    except Exception as error:  # noqa: BLE001 - CLI boundary reports every failure
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
