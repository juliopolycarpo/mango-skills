"""Tests for verify_qualified_head against synthetic Git history."""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "merge-pr" / "scripts" / "python"))

import verify_qualified_head as vq  # noqa: E402

SCRIPT = Path(vq.__file__).resolve()

# Isolate fixture identity and signing from the host configuration. Each test sets
# GIT_CONFIG_GLOBAL to an empty file and supplies identity through the environment.
IDENTITY_ENV_KEYS = {
    "GIT_AUTHOR_NAME": "Fixture",
    "GIT_AUTHOR_EMAIL": "fixture@example.test",
    "GIT_COMMITTER_NAME": "Fixture",
    "GIT_COMMITTER_EMAIL": "fixture@example.test",
}


def _identity_env() -> dict:
    return {**os.environ, **IDENTITY_ENV_KEYS}


class Fixture:
    """Synthetic repo: initial -> main(advanced-base); feature branch with one commit."""

    def __init__(self, root: str) -> None:
        self.repo = os.path.join(root, "repo")
        os.mkdir(self.repo)
        self.git("init", "-qb", "main")
        self.initial = self.commit("initial")
        self.git("checkout", "-qb", "feature")
        self.head = self.commit("feature")
        self.git("checkout", "main")
        self.base = self.commit("advanced-base")

    def git(self, *args: str) -> str:
        result = subprocess.run(
            ["git", "-C", self.repo, *args],
            capture_output=True, text=True, encoding="utf-8", check=False, env=_identity_env(),
        )
        if result.returncode != 0:
            raise RuntimeError(f"Fixture git {args[0]}: {result.stderr}")
        return result.stdout.strip()

    def commit_tree(self, message: str, parents: list) -> str:
        """Commit the index with plumbing so fixture history needs no signing keys or hooks."""
        args = ["commit-tree", self.git("write-tree")]
        for parent in parents:
            args += ["-p", parent]
        sha = self.git(*args, "-m", message)
        self.git("update-ref", "HEAD", sha)
        return sha

    def head_sha(self) -> str:
        return self.git("rev-parse", "HEAD")

    def commit(self, name: str) -> str:
        Path(self.repo, name).write_text(name)
        self.git("add", name)
        unborn = subprocess.run(
            ["git", "-C", self.repo, "rev-parse", "--verify", "-q", "HEAD"],
            capture_output=True, check=False,
        ).returncode != 0
        return self.commit_tree(f"test: {name}", [] if unborn else [self.head_sha()])

    def merge_no_ff(self, other: str, message: str) -> str:
        """Two-parent merge of `other` into the checked-out branch."""
        self.git("merge", "--no-ff", "--no-commit", other)
        parents = [self.head_sha(), other]
        sha = self.commit_tree(message, parents)
        self.git("merge", "--quit")
        return sha

    def squash_merge(self, other: str, message: str) -> str:
        """Single-parent commit holding the content of `other`."""
        self.git("merge", "--squash", other)
        return self.commit_tree(message, [self.head_sha()])


class FixtureTestCase(unittest.TestCase):
    def setUp(self) -> None:
        root = tempfile.mkdtemp(prefix="skills-fix-landing-")
        self.addCleanup(shutil.rmtree, root, True)
        config = os.path.join(root, "empty.gitconfig")
        Path(config).write_text("")
        patcher = mock.patch.dict(
            os.environ, {"GIT_CONFIG_GLOBAL": config, "GIT_CONFIG_NOSYSTEM": "1"}
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.f = Fixture(root)


class VerifyQualifiedHeadTest(FixtureTestCase):
    def test_requires_final_qualification_after_merging_base_retaining_commits(self):
        f = self.f
        f.git("checkout", "feature")
        final = f.merge_no_ff(f.base, "chore: integrate base")
        with self.assertRaisesRegex(RuntimeError, r"\(qualification\)"):
            vq.verify_qualified_head(f.repo, "main", "feature", {"head": f.head, "base": f.base})
        result = vq.verify_qualified_head(f.repo, "main", "feature", {"head": final, "base": f.base})
        self.assertEqual(result, {"head": final, "base": f.base})
        self.assertEqual(list(result), ["head", "base"])
        f.git("merge-base", "--is-ancestor", f.head, final)
        f.commit("new-head")
        with self.assertRaisesRegex(RuntimeError, r"\(qualification\)"):
            vq.verify_qualified_head(f.repo, "main", "feature", {"head": final, "base": f.base})

    def test_rejects_stale_base_receipts_and_unintegrated_base(self):
        f = self.f
        with self.assertRaisesRegex(RuntimeError, r"\(qualification\)"):
            vq.verify_qualified_head(f.repo, "main", "feature", {"head": f.head, "base": f.initial})
        with self.assertRaisesRegex(RuntimeError, r"^\(git merge-base\): expected exit 0 \| received: 1"):
            vq.verify_qualified_head(f.repo, "main", "feature", {"head": f.head, "base": f.base})

    def test_qualification_message_names_expected_and_received(self):
        f = self.f
        with self.assertRaises(RuntimeError) as ctx:
            vq.verify_qualified_head(f.repo, "main", "feature", {"head": "abc", "base": "def"})
        self.assertEqual(
            str(ctx.exception),
            f"(qualification): expected head {f.head}, base {f.base} | received: head abc, base def",
        )

    def test_missing_receipt_is_rejected_as_qualification_failure(self):
        f = self.f
        with self.assertRaisesRegex(RuntimeError, r"^\(qualification\): .*received: head None, base None"):
            vq.verify_qualified_head(f.repo, "main", "feature", None)

    def test_rejects_unresolvable_ref(self):
        with self.assertRaisesRegex(RuntimeError, r"^\(git rev-parse\): expected exit 0 \| received: 128"):
            vq.verify_qualified_head(self.f.repo, "main", "no-such-ref", {})


class MainTest(FixtureTestCase):
    def run_main(self, args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = vq.main(args)
        return code, out.getvalue(), err.getvalue()

    def test_success_prints_indented_json(self):
        f = self.f
        f.git("checkout", "feature")
        final = f.merge_no_ff(f.base, "chore: integrate base")
        code, out, err = self.run_main([f.repo, "main", "feature", final, f.base])
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, json.dumps({"head": final, "base": f.base}, indent=2) + "\n")

    def test_refusal_exits_1_with_message(self):
        f = self.f
        code, out, err = self.run_main([f.repo, "main", "feature", f.base, f.base])
        self.assertEqual((code, out), (1, ""))
        self.assertTrue(err.startswith("(qualification): expected head"))

    def test_wrong_arg_count_prints_usage(self):
        code, out, err = self.run_main(["--invalid-option"])
        self.assertEqual((code, out), (1, ""))
        self.assertEqual(
            err.strip(),
            "Usage: python3 verify_qualified_head.py <repo> <base-ref> <head-ref> "
            "<qualified-head-sha> <qualified-base-sha>",
        )

    def test_subprocess_invalid_option_exits_1(self):
        result = subprocess.run([sys.executable, "-I", str(SCRIPT), "--invalid-option"],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertTrue(result.stderr.startswith("Usage: python3 verify_qualified_head.py"))


if __name__ == "__main__":
    unittest.main()
