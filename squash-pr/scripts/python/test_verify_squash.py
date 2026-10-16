"""Tests for verify_squash against synthetic Git history."""

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

import verify_squash as vs

SCRIPT = Path(vs.__file__).resolve()

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


class VerifySquashTest(unittest.TestCase):
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

    def squash(self) -> str:
        return self.f.squash_merge(self.f.head, "feat: squash")

    def test_verifies_actual_squash_after_independent_base_changes_and_later_landing(self):
        f = self.f
        merge = self.squash()
        later = f.commit("later-landing")
        self.assertNotEqual(f.git("rev-parse", f"{f.head}^{{tree}}"),
                            f.git("rev-parse", f"{merge}^{{tree}}"))
        self.assertEqual(vs.verify_squash(f.repo, f.head, merge, later)["merge"], merge)
        with self.assertRaisesRegex(RuntimeError, r"^\(squash tree\): expected [0-9a-f]+ \| received: [0-9a-f]+$"):
            vs.verify_squash(f.repo, f.head, later, later)
        with self.assertRaisesRegex(RuntimeError, r"^\(git merge-base\): expected exit 0 \| received: 1"):
            vs.verify_squash(f.repo, f.head, merge, f.base)

    def test_result_has_all_keys_in_order(self):
        f = self.f
        merge = self.squash()
        result = vs.verify_squash(f.repo, f.head, merge, merge)
        self.assertEqual(list(result), ["head", "merge", "parent", "base", "tree"])
        self.assertEqual(result["parent"], f.base)
        self.assertEqual(result["tree"], f.git("rev-parse", f"{merge}^{{tree}}"))

    def test_rejects_squash_missing_reviewed_content(self):
        f = self.f
        wrong = f.commit("wrong-content")
        with self.assertRaisesRegex(RuntimeError, r"\(squash tree\)"):
            vs.verify_squash(f.repo, f.head, wrong, wrong)

    def test_rejects_merge_commit_with_two_parents(self):
        f = self.f
        merge = f.merge_no_ff(f.head, "merge feature")
        with self.assertRaises(RuntimeError) as ctx:
            vs.verify_squash(f.repo, f.head, merge, merge)
        self.assertEqual(str(ctx.exception), "(squash parents): expected 1 | received: 2")

    def test_rejects_unresolvable_ref(self):
        with self.assertRaisesRegex(RuntimeError, r"^\(git rev-parse\): expected exit 0 \| received: 128"):
            vs.verify_squash(self.f.repo, "no-such-ref", self.f.head, self.f.base)


class MainTest(unittest.TestCase):
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

    def run_main(self, args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = vs.main(args)
        return code, out.getvalue(), err.getvalue()

    def test_success_prints_indented_json(self):
        f = self.f
        merge = f.squash_merge(f.head, "feat: squash")
        code, out, err = self.run_main([f.repo, f.head, merge, "main"])
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out, json.dumps(json.loads(out), indent=2) + "\n")
        self.assertEqual(json.loads(out)["merge"], merge)

    def test_refusal_exits_1_with_message(self):
        f = self.f
        code, out, err = self.run_main([f.repo, f.head, f.base, "main"])
        self.assertEqual((code, out), (1, ""))
        self.assertIn("(squash", err)

    def test_wrong_arg_count_prints_usage(self):
        code, out, err = self.run_main(["--invalid-option"])
        self.assertEqual((code, out), (1, ""))
        self.assertEqual(
            err.strip(),
            "Usage: python3 verify_squash.py <repo> <reviewed-head> <actual-merge-sha> <fetched-base>",
        )

    def test_subprocess_invalid_option_exits_1(self):
        result = subprocess.run([sys.executable, "-I", str(SCRIPT), "--invalid-option"],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertTrue(result.stderr.startswith("Usage: python3 verify_squash.py"))


if __name__ == "__main__":
    unittest.main()
