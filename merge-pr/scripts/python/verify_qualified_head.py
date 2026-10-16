"""Verify that final branch and base refs match a qualification receipt."""

from __future__ import annotations

import json
import subprocess
import sys

USAGE = (
    "Usage: python3 verify_qualified_head.py <repo> <base-ref> <head-ref> "
    "<qualified-head-sha> <qualified-base-sha>"
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


def verify_qualified_head(
    repo: str, base: str, head: str, receipt: dict[str, str] | None
) -> dict[str, str]:
    """Check that final branch/base refs match a qualification receipt and include the base.

    Imported histories qualify the prepared merge candidate instead of passing this
    ancestry gate. Returns `{"head": sha, "base": sha}`; raises RuntimeError on mismatch.

    Example: verify_qualified_head("/repo", "origin/main", "origin/umbrella",
    {"head": head_sha, "base": base_sha})
    """
    base_sha = _git(repo, ["rev-parse", "--verify", f"{base}^{{commit}}"])
    head_sha = _git(repo, ["rev-parse", "--verify", f"{head}^{{commit}}"])
    received = receipt or {}
    if received.get("head") != head_sha or received.get("base") != base_sha:
        raise RuntimeError(
            f"(qualification): expected head {head_sha}, base {base_sha} | "
            f"received: head {received.get('head')}, base {received.get('base')}"
        )
    _git(repo, ["merge-base", "--is-ancestor", base_sha, head_sha])
    return {"head": head_sha, "base": base_sha}


def main(argv: list[str] | None = None) -> int:
    """Run the CLI and return the process exit code (0 success, 1 failure).

    Example: main(["/repo", "main", "feature", head_sha, base_sha])
    """
    args = sys.argv[1:] if argv is None else argv
    try:
        if len(args) != 5:
            raise RuntimeError(USAGE)
        repo, base, head, qualified_head, qualified_base = args
        result = verify_qualified_head(
            repo, base, head, {"head": qualified_head, "base": qualified_base}
        )
        print(json.dumps(result, indent=2))
    except Exception as error:  # noqa: BLE001 - CLI boundary reports every failure
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
