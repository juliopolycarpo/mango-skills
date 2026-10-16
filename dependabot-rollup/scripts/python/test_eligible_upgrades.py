"""Tests for eligible_upgrades.py, ported from eligible-upgrades.test.mjs. No network access.

Run: python3 -I -m unittest discover -s <this directory> -v
"""
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
import urllib.error
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))

import eligible_upgrades as eu  # noqa: E402

HERE = Path(__file__).resolve().parent
JS_MODULE = HERE.parent / "javascript" / "eligible-upgrades.mjs"
_PARSED_CUTOFF = eu.parse_timestamp("2026-10-12T00:00:00Z")
assert _PARSED_CUTOFF is not None, "(test setup): expected parsable cutoff | received: None"
CUTOFF: int = _PARSED_CUTOFF


def release(version: str, **fields: Any) -> Dict[str, Any]:
    """Build a GitHub release payload published well before the cutoff."""
    base = {
        "tag_name": f"v{version}",
        "draft": False,
        "prerelease": False,
        "published_at": "2026-10-01T00:00:00Z",
    }
    return {**base, **fields}


class FakeEvidence:
    """Named fake for the npm/GitHub evidence source; unknown GitHub endpoints fail loudly."""

    def __init__(self, metadata: Optional[Dict[str, Any]] = None, responses: Optional[Dict[str, Any]] = None):
        self.metadata = metadata
        self.responses = responses or {}
        self.requests: List[str] = []

    def npm(self, name: str) -> Dict[str, Any]:
        self.requests.append(f"npm:{name}")
        return self.metadata or {"status": "error", "reason": "Unexpected npm request"}

    def github(self, endpoint: str) -> Dict[str, Any]:
        self.requests.append(endpoint)
        if endpoint not in self.responses:
            raise AssertionError(
                f"(fake github): expected one of {sorted(self.responses)} | received: {endpoint}"
            )
        return self.responses[endpoint]


class ForbiddenGit:
    """Git runner that fails the test when invoked, proving validation happens first."""

    def __call__(self, args: Sequence[str]) -> str:
        raise AssertionError(f"(fake git): expected no git access | received: {list(args)}")


def npm_row(declaration: str = "1.0.0") -> Dict[str, Any]:
    return eu.discover_manifest("package.json", {}, {"dependencies": {"pkg": declaration}})[0]


def action_row(current: str = "v4.0.0", **extra: Any) -> Dict[str, Any]:
    return {"kind": "action", "name": "owner/action", "current": current, "coverage": "exact", **extra}


def listing(page: int) -> str:
    return f"repos/owner/action/releases?per_page=100&page={page}"


def missing_tags(version: str) -> Dict[str, Any]:
    tags = [f"v{version}", version, f"pkg@{version}", f"pkg-v{version}"]
    return {
        f"repos/owner/repo/releases/tags/{urllib.parse.quote(tag, safe='')}": {"status": "not_found"}
        for tag in tags
    }


def metadata_for(versions: Dict[str, str], repository: Any = "https://github.com/owner/repo") -> Dict[str, Any]:
    return {
        "status": "ok",
        "data": {"versions": {v: {} for v in versions}, "time": dict(versions), "repository": repository},
    }


class GitFixture:
    """Isolated git repository with an empty global config; commits via commit-tree."""

    def __init__(self, test: unittest.TestCase):
        self.dir = Path(tempfile.mkdtemp(prefix="skills-dependency-audit-py-"))
        test.addCleanup(shutil.rmtree, str(self.dir), True)
        self.config = self.dir / "fixture.gitconfig"
        self.config.write_text("")
        self.repo = self.dir / "repo"
        self.repo.mkdir()
        self.env = {**os.environ, "GIT_CONFIG_GLOBAL": str(self.config), "GIT_CONFIG_NOSYSTEM": "1"}
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.test")

    def git(self, *args: str, check: bool = True) -> str:
        completed = subprocess.run(
            ["git", *args], cwd=str(self.repo), env=self.env,
            capture_output=True, universal_newlines=True, check=False,
        )
        if check and completed.returncode != 0:
            raise AssertionError(f"git {' '.join(args)}: expected exit 0 | received: {completed.stderr}")
        return completed.stdout.strip()

    def write(self, name: str, text: str) -> None:
        target = self.repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def commit(self, message: str) -> str:
        self.git("add", ".")
        parent = self.git("rev-parse", "--verify", "--quiet", "HEAD", check=False)
        tree = self.git("write-tree")
        parents = ["-p", parent] if parent else []
        commit = self.git("commit-tree", tree, *parents, "-m", message)
        self.git("update-ref", "HEAD", commit)
        return commit

    def runner(self) -> eu.GitRunner:
        return eu.make_git_runner(cwd=str(self.repo), env=self.env)


class ManifestDiscoveryTests(unittest.TestCase):
    def test_ignores_own_version_and_engines_and_preserves_paths_sections_previous(self) -> None:
        before = {"dependencies": {"pkg": "0.9.0", "unchanged": "1.0.0"}}
        after = {
            "version": "0.7.1",
            "engines": {"bun": "1.4.3"},
            "dependencies": {"pkg": "1.0.0", "unchanged": "1.0.0"},
            "devDependencies": {"pkg": "2.0.0"},
        }
        rows = eu.discover_manifest("apps/a/package.json", before, after)
        self.assertEqual(
            [row["id"] for row in rows],
            ["apps/a/package.json#dependencies:pkg", "apps/a/package.json#devDependencies:pkg"],
        )
        self.assertEqual(rows[0]["previous"], "0.9.0")
        self.assertEqual(rows[0]["current"], "1.0.0")
        self.assertNotEqual(eu.discover_manifest("apps/b/package.json", before, after)[0]["id"], rows[0]["id"])

    def test_aliases_ranges_previews_and_unsupported_declarations_remain_visible(self) -> None:
        rows = eu.discover_manifest(
            "package.json",
            {},
            {
                "dependencies": {
                    "alias": "npm:@scope/pkg@^1.0.0",
                    "preview": "7.0.0-dev.1",
                    "tag": "latest",
                    "local": "workspace:*",
                    "range": "~2.0.0",
                }
            },
            {"package.json#dependencies:alias": "1.2.0"},
        )
        self.assertEqual(
            [row["coverage"] for row in rows],
            ["range", "preview-or-tag", "preview-or-tag", "unsupported", "range"],
        )
        self.assertEqual(rows[0]["alias"], True)
        self.assertEqual(rows[0]["package"], "@scope/pkg")
        self.assertEqual(rows[0]["current"], "1.2.0")
        self.assertEqual(rows[0]["declaration"], "npm:@scope/pkg@^1.0.0")
        self.assertIsNone(rows[4]["current"])

    def test_row_keys_keep_javascript_order(self) -> None:
        self.assertEqual(
            list(npm_row()),
            ["kind", "path", "section", "name", "declaration", "previous", "id", "package",
             "alias", "current", "coverage"],
        )

    def test_resolved_version_outside_declaration_range_remains_unknown(self) -> None:
        row = eu.discover_manifest(
            "package.json", {}, {"dependencies": {"pkg": "^1.0.0"}},
            {"package.json#dependencies:pkg": "2.0.0"},
        )[0]
        self.assertIsNone(row["current"])
        result = eu.assess(row, FakeEvidence(), CUTOFF)
        self.assertEqual(
            result["current_evidence"]["reason"], "Resolved version 2.0.0 does not satisfy ^1.0.0"
        )

    def test_resolution_mappings_cannot_override_exact_manifest_pins(self) -> None:
        row = eu.discover_manifest(
            "package.json", {}, {"dependencies": {"pkg": "1.0.0"}},
            {"package.json#dependencies:pkg": "2.0.0"},
        )[0]
        self.assertEqual(row["current"], "1.0.0")


class ActionDiscoveryTests(unittest.TestCase):
    def test_sha_version_comments_and_unsupported_major_local_image_forms(self) -> None:
        sha = "a" * 40
        yaml = (
            "jobs:\n  test:\n    steps:\n"
            f"      - uses: owner/action@{sha} # v4.1.0\n"
            "      - uses: owner/other@v3\n      - uses: ./local\n      - uses: docker://image:1\n"
        )
        rows = eu.discover_actions(".github/workflows/ci.yml", "", yaml)
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0]["current"], "v4.1.0")
        self.assertEqual(rows[0]["pin"], sha)
        self.assertEqual(rows[0]["coverage"], "exact")
        self.assertTrue(all(row["coverage"] == "unsupported" for row in rows[1:]))
        self.assertEqual(eu.discover_actions("ci.yml", yaml, yaml), [])

    def test_retains_added_occurrences_after_reordered_existing_pins(self) -> None:
        before = "steps:\n  - uses: owner/action@v1.0.0\n  - uses: owner/action@v2.0.0\n"
        after = (
            "steps:\n  - uses: owner/action@v2.0.0\n  - uses: owner/action@v1.0.0\n"
            "  - uses: owner/action@v2.0.0\n"
        )
        rows = eu.discover_actions("ci.yml", before, after)
        self.assertEqual(
            [(row["id"], row["current"], row["coverage"]) for row in rows],
            [("ci.yml#uses:2:owner/action@v2.0.0", "v2.0.0", "exact")],
        )
        self.assertEqual(eu.discover_actions("ci.yml", before, before), [])

    def test_covers_step_adopting_pin_already_used_by_another_step(self) -> None:
        before = (
            "steps:\n  - name: first\n    uses: owner/action@v1.0.0\n"
            "  - name: second\n    uses: owner/action@v2.0.0\n"
        )
        rows = eu.discover_actions("ci.yml", before, before.replace("@v1.0.0", "@v2.0.0"))
        self.assertEqual(
            [(row["declaration"], row["current"]) for row in rows],
            [("owner/action@v2.0.0", "v2.0.0")],
        )

    def test_retains_added_unsupported_major_pin_with_unknown_evidence(self) -> None:
        before = "steps:\n  - uses: owner/action@v2\n"
        rows = eu.discover_actions("ci.yml", before, before + "  - uses: owner/action@v2\n")
        self.assertEqual(
            [(row["id"], row["current"], row["coverage"]) for row in rows],
            [("ci.yml#uses:1:owner/action@v2", None, "unsupported")],
        )
        evidence = FakeEvidence()
        result = eu.assess(rows[0], evidence, CUTOFF)
        self.assertEqual(result["current_evidence"]["status"], "unknown")
        self.assertEqual(result["completeness"], "unknown")
        self.assertEqual(evidence.requests, [])

    def test_duplicate_sha_cannot_borrow_other_occurrences_version_comment(self) -> None:
        declaration = "owner/action@" + "a" * 40
        after = (
            f"steps:\n  - uses: {declaration} # v1.0.0\n"
            f"  - uses: {declaration} # v2.0.0\n"
        )
        rows = eu.discover_actions("ci.yml", "", after)
        self.assertEqual(
            [(row["current"], row["coverage"]) for row in rows],
            [(None, "unsupported"), (None, "unsupported")],
        )
        self.assertEqual(eu.discover_actions("ci.yml", after, after), [])
        changed = eu.discover_actions(
            "ci.yml", f"steps:\n  - uses: {declaration} # v1.0.0\n", after
        )
        self.assertEqual(
            [(row["id"], row["current"], row["coverage"]) for row in changed],
            [(f"ci.yml#uses:1:{declaration}", None, "unsupported")],
        )

    def test_sha_comments_exclude_ambiguous_text_and_multiple_uses_on_one_line(self) -> None:
        declaration = "owner/action@" + "a" * 40
        source = (
            f"steps:\n  - run: echo '{declaration}' # v1.0.0\n"
            f"  - uses: {declaration}\n"
        )
        rows = eu.discover_actions("ci.yml", "", source)
        self.assertEqual(
            [(row["current"], row["coverage"]) for row in rows], [(None, "unsupported")]
        )
        flow = f"steps: [{{uses: {declaration}}}, {{uses: {declaration}}}] # v1.0.0"
        self.assertEqual(
            [row["current"] for row in eu.discover_actions("ci.yml", "", flow)], [None, None]
        )

    def test_rows_without_a_pin_omit_the_pin_key_like_json_stringify(self) -> None:
        row = eu.discover_actions("ci.yml", "", "steps:\n  - uses: ./local\n")[0]
        self.assertNotIn("pin", row)
        self.assertEqual(row["name"], "./local")
        self.assertEqual(row["id"], "ci.yml#uses:0:./local")


class AssessNpmTests(unittest.TestCase):
    def test_missing_current_publication_evidence_is_unknown_even_with_valid_release(self) -> None:
        evidence = FakeEvidence(
            metadata={
                "status": "ok",
                "data": {
                    "versions": {"1.0.0": {}},
                    "time": {},
                    "repository": "https://github.com/owner/repo.git",
                },
            },
            responses={"repos/owner/repo/releases/tags/v1.0.0": {"status": "ok", "data": release("1.0.0")}},
        )
        row = eu.assess(npm_row(), evidence, CUTOFF)
        self.assertEqual(row["current_evidence"]["status"], "unknown")
        self.assertEqual(row["completeness"], "unknown")

    def test_403_lookup_remains_unknown_and_404_exhausts_tag_patterns_as_ineligible(self) -> None:
        metadata = metadata_for(
            {"1.0.0": "2026-10-01"}, repository={"url": "git+https://github.com/owner/repo.git"}
        )
        denied = eu.assess(
            npm_row(),
            FakeEvidence(
                metadata,
                {"repos/owner/repo/releases/tags/v1.0.0": {"status": "error", "reason": "HTTP 403"}},
            ),
            CUTOFF,
        )
        self.assertEqual(denied["current_evidence"], {"status": "unknown", "reason": "HTTP 403"})
        missing = eu.assess(npm_row(), FakeEvidence(metadata, missing_tags("1.0.0")), CUTOFF)
        self.assertEqual(missing["current_evidence"]["status"], "ineligible")
        self.assertIn("404", missing["current_evidence"]["reason"])

    def test_checks_current_age_and_candidate_publication_age_and_excludes_previews(self) -> None:
        versions = ["1.0.0", "1.1.0", "1.2.0", "2.0.0-beta.1"]
        metadata = metadata_for({v: "2026-10-01" for v in versions})
        responses = {
            f"repos/owner/repo/releases/tags/v{v}": {
                "status": "ok",
                "data": release(v, **({"published_at": "2026-10-14"} if v != "1.1.0" else {})),
            }
            for v in versions[:3]
        }
        result = eu.assess(npm_row(), FakeEvidence(metadata, responses), CUTOFF)
        self.assertEqual(result["current_evidence"]["status"], "ineligible")
        self.assertEqual(result["eligible"], "1.1.0")
        self.assertEqual(result["candidates"][0]["version"], "1.2.0")
        self.assertEqual(result["candidates"][0]["status"], "ineligible")
        self.assertEqual(result["preview_versions"], ["2.0.0-beta.1"])
        self.assertEqual(result["newer_stable_count"], 2)
        self.assertEqual(
            list(result)[-6:],
            ["candidates", "completeness", "recommendation", "preview_versions", "newer_stable_count", "eligible"],
        )

    def test_higher_candidate_lookup_errors_keep_recommendation_unknown(self) -> None:
        metadata = metadata_for({"1.0.0": "2026-10-01", "1.1.0": "2026-10-01", "1.2.0": "2026-10-01"})
        responses = {
            "repos/owner/repo/releases/tags/v1.0.0": {"status": "ok", "data": release("1.0.0")},
            "repos/owner/repo/releases/tags/v1.1.0": {"status": "ok", "data": release("1.1.0")},
            "repos/owner/repo/releases/tags/v1.2.0": {"status": "error", "reason": "Network failure"},
        }
        result = eu.assess(npm_row(), FakeEvidence(metadata, responses), CUTOFF)
        self.assertEqual(result["eligible"], "1.1.0")
        self.assertEqual(result["recommendation"], "unknown")
        self.assertEqual(result["completeness"], "unknown")

    def test_unresolved_ranges_and_previews_perform_no_external_io(self) -> None:
        evidence = FakeEvidence()
        for declaration in ("^1.0.0", "latest", "1.0.0-beta.1", "workspace:*"):
            with self.subTest(declaration=declaration):
                result = eu.assess(npm_row(declaration), evidence, CUTOFF)
                self.assertEqual(result["completeness"], "unknown")
        self.assertEqual(evidence.requests, [])

    def test_registry_failures_become_unknown_current_evidence(self) -> None:
        cases = [
            ({"status": "not_found"}, "Registry package not found"),
            ({"status": "error", "reason": "HTTP 500"}, "HTTP 500"),
            ({"status": "ok", "data": {"versions": None}}, "Missing registry versions"),
            ({"status": "ok", "data": {"versions": {"2.0.0": {}}}}, "Exact version absent from registry versions"),
        ]
        for metadata, reason in cases:
            with self.subTest(reason=reason):
                result = eu.assess(npm_row(), FakeEvidence(metadata), CUTOFF)
                self.assertEqual(result["current_evidence"], {"status": "unknown", "reason": reason})

    def test_empty_registry_versions_object_is_present_but_lacks_the_current_version(self) -> None:
        metadata = {"status": "ok", "data": {"versions": {}, "time": {}, "repository": "https://github.com/owner/repo"}}
        result = eu.assess(npm_row(), FakeEvidence(metadata), CUTOFF)
        self.assertEqual(
            result["current_evidence"],
            {"status": "unknown", "reason": "Exact version absent from registry versions"},
        )
        self.assertEqual(result["newer_stable_count"], 0)

    def test_alias_packages_use_short_name_tag_patterns(self) -> None:
        row = eu.discover_manifest("package.json", {}, {"dependencies": {"x": "npm:@scope/pkg@1.0.0"}})[0]
        metadata = metadata_for({"1.0.0": "2026-10-01"})
        endpoints = [
            "repos/owner/repo/releases/tags/v1.0.0",
            "repos/owner/repo/releases/tags/1.0.0",
            "repos/owner/repo/releases/tags/%40scope%2Fpkg%401.0.0",
            "repos/owner/repo/releases/tags/pkg%401.0.0",
            "repos/owner/repo/releases/tags/pkg-v1.0.0",
        ]
        evidence = FakeEvidence(metadata, {e: {"status": "not_found"} for e in endpoints})
        eu.assess(row, evidence, CUTOFF)
        self.assertEqual(evidence.requests, ["npm:@scope/pkg"] + endpoints)


class AssessActionTests(unittest.TestCase):
    def test_current_evidence_requires_exact_tag_including_v_prefix(self) -> None:
        for current, other_tag in [("4.0.0", "v4.0.0"), ("v4.0.0", "4.0.0")]:
            with self.subTest(current=current):
                evidence = FakeEvidence(responses={listing(1): {
                    "status": "ok", "data": [release("4.0.0", tag_name=other_tag)]
                }})
                result = eu.assess(action_row(current), evidence, CUTOFF)
                self.assertEqual(result["current_evidence"]["status"], "unknown")
                self.assertEqual(result["completeness"], "unknown")


    def test_paginates_beyond_first_100_releases_and_respects_pinned_major(self) -> None:
        page1 = [release("9.0.0") for _ in range(100)]
        evidence = FakeEvidence(
            responses={
                listing(1): {"status": "ok", "data": page1},
                listing(2): {"status": "ok", "data": [release("4.1.0"), release("4.0.0")]},
            }
        )
        result = eu.assess(action_row(), evidence, CUTOFF)
        self.assertEqual(evidence.requests, [listing(1), listing(2)])
        self.assertEqual(result["eligible"], "v4.1.0")
        self.assertEqual(result["recommendation"], "eligible-newer-version")
        self.assertEqual(result["completeness"], "complete")
        self.assertEqual(result["current_evidence"]["status"], "eligible")

    def test_failed_pagination_or_missing_current_release_never_passes_age_policy(self) -> None:
        incomplete = eu.assess(
            action_row(),
            FakeEvidence(responses={listing(1): {"status": "error", "reason": "HTTP 429"}}),
            CUTOFF,
        )
        self.assertEqual(incomplete["current_evidence"], {"status": "unknown", "reason": "HTTP 429"})
        missing = eu.assess(
            action_row(),
            FakeEvidence(responses={listing(1): {"status": "ok", "data": [release("4.1.0")]}}),
            CUTOFF,
        )
        self.assertEqual(missing["current_evidence"]["status"], "unknown")
        self.assertEqual(missing["completeness"], "unknown")

    def test_listing_without_reason_reports_incomplete_listing(self) -> None:
        result = eu.assess(
            action_row(), FakeEvidence(responses={listing(1): {"status": "not_found"}}), CUTOFF
        )
        self.assertEqual(
            result["current_evidence"], {"status": "unknown", "reason": "Incomplete Actions release listing"}
        )

    def test_sha_comment_must_resolve_to_pinned_action_commit(self) -> None:
        row = action_row(pin="a" * 40)
        responses = {
            listing(1): {"status": "ok", "data": [release("4.0.0")]},
            "repos/owner/action/commits/v4.0.0": {"status": "ok", "data": {"sha": "b" * 40}},
        }
        result = eu.assess(row, FakeEvidence(responses=responses), CUTOFF)
        self.assertEqual(
            result["current_evidence"],
            {"status": "unknown", "reason": "Pinned SHA does not match version tag"},
        )

    def test_matching_pinned_sha_passes(self) -> None:
        row = action_row(pin="a" * 40)
        responses = {
            listing(1): {"status": "ok", "data": [release("4.0.0")]},
            "repos/owner/action/commits/v4.0.0": {"status": "ok", "data": {"sha": "a" * 40}},
        }
        result = eu.assess(row, FakeEvidence(responses=responses), CUTOFF)
        self.assertEqual(result["current_evidence"]["status"], "eligible")

    def test_no_newer_stable_version_is_distinct_from_versions_failing_policy(self) -> None:
        equal = eu.assess(
            action_row(),
            FakeEvidence(responses={listing(1): {"status": "ok", "data": [release("4.0.0")]}}),
            CUTOFF,
        )
        self.assertEqual(equal["recommendation"], "no-newer-stable-version")
        young = eu.assess(
            action_row(),
            FakeEvidence(
                responses={
                    listing(1): {
                        "status": "ok",
                        "data": [release("4.0.0"), release("4.1.0", published_at="2026-10-14")],
                    }
                }
            ),
            CUTOFF,
        )
        self.assertEqual(young["recommendation"], "no-eligible-newer-version")


class InventoryTests(unittest.TestCase):
    def test_structural_inventory_reads_merge_base_manifests_and_added_files(self) -> None:
        fixture = GitFixture(self)
        fixture.write("package.json", json.dumps({"version": "0.7.0", "dependencies": {"pkg": "1.0.0"}}))
        base = fixture.commit("base")
        fixture.write("package.json", json.dumps({"version": "0.7.1", "dependencies": {"pkg": "1.1.0"}}))
        fixture.write("new/package.json", json.dumps({"devDependencies": {"pkg": "2.0.0"}}))
        fixture.write("Cargo.toml", '[package]\nname="fixture"')
        fixture.commit("candidate")
        inventory = eu.discover_changes(base, "HEAD", run_git=fixture.runner())
        self.assertEqual(
            [row["id"] for row in inventory["rows"]],
            ["new/package.json#devDependencies:pkg", "package.json#dependencies:pkg"],
        )
        self.assertEqual(
            inventory["uncovered"], [{"path": "Cargo.toml", "coverage": "unsupported-ecosystem"}]
        )
        self.assertEqual(list(inventory), ["base", "base_tip", "head", "rows", "uncovered"])

    def test_renamed_manifests_and_workflows_keep_old_path_comparison(self) -> None:
        fixture = GitFixture(self)
        filler = "Rename detection fixture " * 60

        def manifest(version: str) -> str:
            return json.dumps(
                {"name": "fixture", "description": filler, "dependencies": {"changed": version, "unchanged": "1.0.0"}},
                indent=2,
            )

        def workflow(version: str) -> str:
            return (
                f"name: Fixture\n# {filler}\njobs:\n  test:\n    steps:\n"
                f"      - uses: owner/changed@{version}\n      - uses: owner/unchanged@v1.0.0\n"
            )

        fixture.write("old/package.json", manifest("1.0.0"))
        fixture.write("old/ci.yml", workflow("v1.0.0"))
        base = fixture.commit("base")
        shutil.rmtree(str(fixture.repo / "old"))
        fixture.write("new/package.json", manifest("2.0.0"))
        fixture.write("new/ci.yml", workflow("v2.0.0"))
        fixture.commit("rename and upgrade")
        statuses = fixture.git("diff", "--name-status", base, "HEAD").split("\n")
        self.assertTrue(all(line.startswith("R") for line in statuses), statuses)
        inventory = eu.discover_changes(base, "HEAD", run_git=fixture.runner())
        self.assertEqual([row["name"] for row in inventory["rows"]], ["owner/changed", "changed"])
        self.assertEqual(inventory["rows"][0]["path"], "new/ci.yml")
        self.assertEqual(inventory["rows"][0]["current"], "v2.0.0")
        self.assertEqual(inventory["rows"][1]["path"], "new/package.json")
        self.assertEqual(inventory["rows"][1]["previous"], "1.0.0")
        self.assertEqual(inventory["rows"][1]["current"], "2.0.0")

    def test_moving_branch_refs_cannot_change_inventory_or_receipt(self) -> None:
        fixture = GitFixture(self)

        def manifest(version: str) -> str:
            return json.dumps({"dependencies": {"pkg": version}})

        fixture.write("package.json", manifest("1.0.0"))
        base = fixture.commit("base")
        fixture.git("branch", "base-ref", base)
        fixture.write("package.json", manifest("1.1.0"))
        reviewed_head = fixture.commit("reviewed candidate")
        fixture.git("branch", "candidate-ref", reviewed_head)
        fixture.write("package.json", manifest("9.0.0"))
        advanced_head = fixture.commit("concurrent advance")
        requests: List[List[str]] = []
        advanced: List[bool] = []
        real = fixture.runner()

        def git_with_concurrent_advance(args: Sequence[str]) -> str:
            requests.append(list(args))
            output = real(args)
            if args[0] == "merge-base":
                fixture.git("update-ref", "refs/heads/candidate-ref", advanced_head)
                fixture.git("update-ref", "refs/heads/base-ref", advanced_head)
                advanced.append(True)
            return output

        inventory = eu.discover_changes("base-ref", "candidate-ref", None, git_with_concurrent_advance)
        self.assertEqual(advanced, [True])
        self.assertEqual(fixture.git("rev-parse", "candidate-ref"), advanced_head)
        self.assertEqual(inventory["rows"][0]["current"], "1.1.0")
        self.assertEqual(inventory["head"], reviewed_head)
        self.assertEqual(inventory["base"], base)
        self.assertEqual(len([r for r in requests if r[0] == "rev-parse"]), 2)

    def test_git_failures_name_the_command_and_stderr(self) -> None:
        fixture = GitFixture(self)
        with self.assertRaisesRegex(eu.GitError, r"\(git rev-parse .*\): expected exit code 0 \| received: exit \d+"):
            eu.discover_changes("missing-ref", "HEAD", run_git=fixture.runner())


class TransportTests(unittest.TestCase):
    @staticmethod
    def fake_fetch(status: int, data: Any):
        def fetch_registry(url: str, timeout: float) -> eu.FetchResponse:
            return eu.FetchResponse(status, json.dumps(data).encode("utf-8"))

        return fetch_registry

    @staticmethod
    def fake_gh(status: int, data: Any, exit_code: int = 0):
        def run_gh(args: Sequence[str]) -> eu.CommandResult:
            assert list(args[:3]) == ["gh", "api", "--include"], args
            return eu.CommandResult(
                exit_code,
                f"HTTP/2.0 {status}\r\nContent-Type: application/json\r\n\r\n{json.dumps(data)}",
                f"HTTP {status}" if exit_code else "",
            )

        return run_gh

    def test_normalizes_crlf_headers_and_distinguishes_404_and_403(self) -> None:
        ok = eu.create_evidence(run=self.fake_gh(200, release("1.0.0")), fetcher=self.fake_fetch(200, {"versions": {}}))
        self.assertEqual(ok.github("repos/owner/repo/releases")["data"]["tag_name"], "v1.0.0")
        self.assertEqual(ok.npm("@scope/pkg")["status"], "ok")
        missing = eu.create_evidence(run=self.fake_gh(404, {}, 1), fetcher=self.fake_fetch(404, {}))
        self.assertEqual(missing.github("missing")["status"], "not_found")
        self.assertEqual(missing.npm("missing")["status"], "not_found")
        denied = eu.create_evidence(run=self.fake_gh(403, {}, 1), fetcher=self.fake_fetch(403, {}))
        self.assertEqual(denied.github("denied"), {"status": "error", "reason": "HTTP 403"})
        self.assertEqual(denied.npm("denied"), {"status": "error", "reason": "HTTP 403"})

    def test_npm_requests_percent_encode_scoped_names(self) -> None:
        urls: List[str] = []

        def record(url: str, timeout: float) -> eu.FetchResponse:
            urls.append(url)
            return eu.FetchResponse(200, b"{}")

        eu.create_evidence(fetcher=record).npm("@scope/pkg")
        self.assertEqual(urls, ["https://registry.npmjs.org/%40scope%2Fpkg"])

    def test_operational_failures_become_error_statuses(self) -> None:
        def broken_fetch(url: str, timeout: float) -> eu.FetchResponse:
            raise OSError("connection refused")

        def missing_gh(args: Sequence[str]) -> eu.CommandResult:
            raise FileNotFoundError("gh not installed")

        def silent_failure(args: Sequence[str]) -> eu.CommandResult:
            return eu.CommandResult(4, "", "")

        def bad_json(args: Sequence[str]) -> eu.CommandResult:
            return eu.CommandResult(0, "HTTP/2.0 200\n\nnot json")

        evidence = eu.create_evidence(fetcher=broken_fetch, run=missing_gh)
        self.assertEqual(evidence.npm("x"), {"status": "error", "reason": "connection refused"})
        self.assertEqual(evidence.github("x"), {"status": "error", "reason": "gh not installed"})
        self.assertEqual(
            eu.create_evidence(run=silent_failure).github("x"), {"status": "error", "reason": "exit 4"}
        )
        invalid = eu.create_evidence(run=bad_json).github("x")
        self.assertEqual(invalid["status"], "error")
        self.assertTrue(invalid["reason"].startswith("Invalid GitHub JSON:"), invalid)

    def test_default_fetcher_maps_http_errors_to_statuses(self) -> None:
        class FakeResponse:
            status = 200

            def __enter__(self) -> "FakeResponse":
                return self

            def __exit__(self, *exc: Any) -> None:
                return None

            def read(self) -> bytes:
                return b'{"ok": true}'

        def urlopen_ok(url: str, timeout: float) -> FakeResponse:
            return FakeResponse()

        def urlopen_404(url: str, timeout: float) -> FakeResponse:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)  # type: ignore[arg-type]

        ok = eu.make_url_fetcher(urlopen_ok)("https://example.test", 1)
        self.assertEqual((ok.status, ok.json()), (200, {"ok": True}))
        self.assertEqual(eu.make_url_fetcher(urlopen_404)("https://example.test", 1).status, 404)


class HelperTests(unittest.TestCase):
    def test_satisfies_range_follows_npm_semantics(self) -> None:
        cases = [
            ("1.2.5", "^1.0.0", True), ("1.0.0", "^1.0.0", True), ("2.0.0", "^1.0.0", False),
            ("0.9.9", "^1.0.0", False), ("1.2.2", "^1.2.3", False), ("0.2.9", "^0.2.3", True),
            ("0.3.0", "^0.2.3", False), ("0.0.3", "^0.0.3", True), ("0.0.4", "^0.0.3", False),
            ("1.2.9", "~1.2.3", True), ("1.3.0", "~1.2.3", False), ("1.9.9", "~1.2.3", False),
            ("v1.2.5", "^1.0.0", True), ("1.2.3", "1.2.3", True), ("1.2.4", "1.2.3", False),
            ("1.2.3-beta.1", "^1.0.0", False), ("1.2.3", "latest", False), ("1.2.3", ">=1.0.0", False),
        ]
        for version, spec, expected in cases:
            with self.subTest(version=version, spec=spec):
                self.assertEqual(eu.satisfies_range(version, spec), expected)

    def test_extract_uses_reads_nested_quoted_commented_and_flow_values_in_order(self) -> None:
        yaml = "\n".join([
            "name: CI",
            "on: [push]",
            "jobs:",
            "  build:",
            "    uses: owner/reusable/.github/workflows/build.yml@v1",
            "    steps:",
            "      - uses: actions/checkout@v4 # pinned",
            "      - name: quoted",
            '        uses: "owner/double@v2"',
            "      - uses: 'owner/single@v3' # trailing",
            "      - run: |",
            "          echo 'uses: not/an-action@v0'",
            "          uses: also/not@v0",
            "      - { name: flow, uses: owner/flow@v5 }",
            "      - uses: ./local",
            "      - uses: docker://image:1",
            "      - uses: ${{ matrix.action }}",
            "      - uses:",
            "      - with:",
            "          uses: owner/nested@v6",
            "",
        ])
        self.assertEqual(
            eu.extract_uses(yaml),
            [
                "owner/reusable/.github/workflows/build.yml@v1",
                "actions/checkout@v4",
                "owner/double@v2",
                "owner/single@v3",
                "owner/flow@v5",
                "./local",
                "docker://image:1",
                "${{ matrix.action }}",
                "uses:",
                "owner/nested@v6",
            ],
        )
        self.assertEqual(eu.extract_uses(""), [])
        self.assertEqual(eu.extract_uses("uses: owner/crlf@v1\r\n"), ["owner/crlf@v1"])

    def test_extract_uses_handles_escapes_and_non_string_scalars(self) -> None:
        self.assertEqual(eu.extract_uses('uses: "a\\"b"'), ['a"b'])
        self.assertEqual(eu.extract_uses("uses: 'it''s'"), ["it's"])
        self.assertEqual(eu.extract_uses("uses: true\nuses: 12\nuses: null\nuses: # none"), ["uses:"])
        self.assertEqual(eu.extract_uses('"uses": x/y@v1'), ["x/y@v1"])

    def test_extract_uses_resolves_anchors_and_tags_and_surfaces_unreadable_values_raw(self) -> None:
        extract = eu.extract_uses
        self.assertEqual(
            extract("steps:\n  - uses: &co actions/checkout@v5\n  - uses: *co\n"),
            ["actions/checkout@v5", "*co"],
        )
        self.assertEqual(extract("uses: !!str owner/tag@v1"), ["owner/tag@v1"])
        self.assertEqual(extract('uses: &a !t "owner/both@v2"'), ["owner/both@v2"])
        self.assertEqual(extract("uses: &only"), ["&only"])
        self.assertEqual(extract("uses: |\n  owner/block@v1\nnext: x"), ["|"])
        self.assertEqual(extract("uses: >-\n  owner/folded@v1"), [">-"])
        self.assertEqual(extract("uses: [owner/a@v1, b]"), ["[owner/a@v1, b]"])
        self.assertEqual(extract("uses: 'open\n  quote@v1'\nuses: after/q@v1"), ["'open", "after/q@v1"])
        self.assertEqual(extract("uses: *alias # note"), ["*alias"])

    def test_extract_uses_reads_explicit_mapping_keys(self) -> None:
        extract = eu.extract_uses
        self.assertEqual(extract("? uses\n: actions/checkout@v5\n"), ["actions/checkout@v5"])
        self.assertEqual(extract('- ? "uses"\n  : *x\n'), ["*x"])
        self.assertEqual(extract("? other\n: actions/skip@v1\n"), [])
        self.assertEqual(extract("? uses\nname: x\n"), [])

    def test_extract_uses_never_invents_values_from_quotes_block_scalars_or_flow_content(self) -> None:
        extract = eu.extract_uses
        self.assertEqual(extract("run: \"echo '{uses: evil/x@v1}'\""), [])
        self.assertEqual(extract('other: "a, uses: evil@v1 {"'), [])
        self.assertEqual(extract("args:\n  - |\n    uses: evil/y@v1\n"), [])
        self.assertEqual(extract("args:\n  - >-\n    uses: evil/y@v1\nuses: real/a@v1\n"), ["real/a@v1"])
        self.assertEqual(extract('run: "echo\n  uses: evil/z@v2"\nuses: real/b@v1'), ["real/b@v1"])
        self.assertEqual(extract('- "echo\n  uses: evil/z@v2"\n- uses: real/c@v1'), ["real/c@v1"])
        self.assertEqual(extract('x: {a: "evil, uses: bad@v1"}'), [])
        self.assertEqual(extract("x: {a: 'it''s, uses: bad@v1'}"), [])

    def test_extract_uses_reads_multi_line_and_nested_flow_mappings_without_delimiters(self) -> None:
        extract = eu.extract_uses
        self.assertEqual(extract("- {name: a,\n   uses: o/a@v1}\n- uses: next/b@v1"), ["o/a@v1", "next/b@v1"])
        self.assertEqual(extract("- { name: flow, uses: owner/flow@v5 }"), ["owner/flow@v5"])
        self.assertEqual(extract("with: {uses: k/l@v6}"), ["k/l@v6"])
        self.assertEqual(extract("x: [uses: r/s@v1]"), ["r/s@v1"])
        self.assertEqual(extract('x: {a: [{uses: deep/n@v1}], uses: "q/m@v2"}'), ["deep/n@v1", "q/m@v2"])
        self.assertEqual(extract("- {uses: *ref, name: z}"), ["*ref"])
        self.assertEqual(extract("- {uses: ${{ matrix.action }}}"), ["${{ matrix.action }}"])
        self.assertEqual(extract("- {name: a, # note\n   uses: o/c@v1}"), ["o/c@v1"])

    def test_discover_actions_surfaces_alias_and_anchor_declarations(self) -> None:
        rows = eu.discover_actions("ci.yml", "", "steps:\n  - uses: &co actions/checkout@v5\n  - uses: *co\n")
        self.assertEqual(
            [(row["declaration"], row["name"], row["coverage"]) for row in rows],
            [("actions/checkout@v5", "actions/checkout", "unsupported"), ("*co", "*co", "unsupported")],
        )

    def test_compare_orders_numerically_and_rejects_unstable_versions(self) -> None:
        self.assertLess(eu.compare("1.2.0", "1.10.0"), 0)
        self.assertEqual(eu.compare("v1.0.0", "1.0.0"), 0)
        with self.assertRaisesRegex(ValueError, r"\(compare\): expected stable versions x\.y\.z \| received: '1\.0' and '1\.0\.0'"):
            eu.compare("1.0", "1.0.0")

    def test_js_number_matches_javascript_number(self) -> None:
        self.assertEqual(eu.js_number(" 3 "), 3.0)
        self.assertEqual(eu.js_number(""), 0.0)
        self.assertEqual(eu.js_number("1e3"), 1000.0)
        self.assertEqual(eu.js_number("0x10"), 16.0)
        self.assertEqual(eu.js_number("-1"), -1.0)
        self.assertEqual(eu.js_number("-Infinity"), float("-inf"))
        for invalid in ("1_000", "abc", "nan", "1,5", "inf"):
            with self.subTest(invalid=invalid):
                self.assertNotEqual(eu.js_number(invalid), eu.js_number(invalid))

    def test_parse_timestamp_accepts_iso_forms_and_rejects_others(self) -> None:
        self.assertEqual(eu.parse_timestamp("1970-01-01T00:00:00Z"), 0)
        self.assertEqual(eu.parse_timestamp("1970-01-02"), 86400000)
        self.assertEqual(eu.parse_timestamp("1970-01-01T01:00:00+01:00"), 0)
        self.assertEqual(eu.parse_timestamp("1970-01-01T00:00:00.123Z"), 123)
        self.assertEqual(eu.parse_timestamp("2026-10-01"), eu.parse_timestamp("2026-10-01T00:00:00Z"))
        for invalid in (None, 5, "", "yesterday", "2026-13-01", "2026-02-30"):
            with self.subTest(invalid=invalid):
                self.assertIsNone(eu.parse_timestamp(invalid))

    def test_format_iso_matches_to_iso_string(self) -> None:
        self.assertEqual(eu.format_iso(0), "1970-01-01T00:00:00.000Z")
        self.assertEqual(eu.format_iso(CUTOFF), "2026-10-12T00:00:00.000Z")
        self.assertEqual(eu.format_iso(-1), "1969-12-31T23:59:59.999Z")
        with self.assertRaisesRegex(ValueError, r"\(format_iso\): expected epoch milliseconds between"):
            eu.format_iso(10 ** 15)

    def test_encode_uri_component_matches_javascript(self) -> None:
        self.assertEqual(eu.encode_uri_component("@scope/pkg@1.0.0"), "%40scope%2Fpkg%401.0.0")
        self.assertEqual(eu.encode_uri_component("a-b_c.d~e!f*g'h(i)"), "a-b_c.d~e!f*g'h(i)")
        self.assertEqual(eu.encode_uri_component("a b"), "a%20b")

    def test_release_check_states(self) -> None:
        check = eu._release_check
        self.assertEqual(check(None, None, CUTOFF)["reason"], "Missing release flags")
        self.assertEqual(check({"draft": False}, None, CUTOFF)["reason"], "Missing release flags")
        self.assertEqual(check(release("1.0.0", draft=True), "2026-10-01", CUTOFF)["status"], "ineligible")
        self.assertEqual(check(release("1.0.0"), "garbage", CUTOFF)["reason"], "Missing or invalid publication time")
        eligible = check(release("1.0.0"), "2026-10-01", CUTOFF)
        self.assertEqual(eligible["status"], "eligible")
        self.assertEqual(eligible["tag"], "v1.0.0")
        no_tag = release("1.0.0")
        del no_tag["tag_name"]
        self.assertNotIn("tag", check(no_tag, "2026-10-01", CUTOFF))

    def test_repo_of_understands_string_and_object_repositories(self) -> None:
        self.assertEqual(eu._repo_of({"repository": "git+https://github.com/o/r.git"}), "o/r")
        self.assertEqual(eu._repo_of({"repository": {"url": "git@github.com:o/r.git#main"}}), "o/r")
        self.assertIsNone(eu._repo_of({"repository": "https://gitlab.com/o/r"}))
        self.assertIsNone(eu._repo_of({}))

    def test_parse_json_rejects_non_finite_constants(self) -> None:
        self.assertEqual(eu.parse_json('{"a": [1, 2]}'), {"a": [1, 2]})
        with self.assertRaisesRegex(ValueError, r"\(json\): expected strict JSON \| received constant: NaN"):
            eu.parse_json("NaN")


class CliTests(unittest.TestCase):
    def test_changed_non_inline_uses_exits_2_without_network(self) -> None:
        fixture = GitFixture(self)
        before = "steps:\n  - uses:\n      owner/action@v1.0.0\n"
        fixture.write(".github/workflows/ci.yml", before)
        base = fixture.commit("base")
        fixture.write(".github/workflows/ci.yml", before.replace("v1.0.0", "v2.0.0"))
        head = fixture.commit("changed action")
        lines: List[str] = []
        evidence = FakeEvidence()
        code = eu.main(["--base", base, "--head", head, "--json"],
                       evidence=evidence, run_git=fixture.runner(), out=lines.append)
        report = json.loads("\n".join(lines))
        self.assertEqual(code, 2, "expected unsupported non-inline uses to exit 2")
        self.assertEqual(len(report["rows"]), 1)
        self.assertEqual(report["rows"][0]["coverage"], "unsupported")
        self.assertEqual(report["rows"][0]["declaration"], "uses:\n      owner/action@v2.0.0")
        self.assertEqual(evidence.requests, [])

    def test_rejects_invalid_flags_and_age_before_accessing_repository_or_network(self) -> None:
        with self.assertRaisesRegex(ValueError, r"\(--min-days\): expected finite nonnegative number \| received: -1"):
            eu.main(["--min-days", "-1"], run_git=ForbiddenGit())
        with self.assertRaisesRegex(ValueError, r"\(--min-days\): expected finite nonnegative number \| received: 1_0"):
            eu.main(["--min-days", "1_0"], run_git=ForbiddenGit())
        with self.assertRaisesRegex(ValueError, r"\(arguments\): expected .* \| received: --base without a value"):
            eu.main(["--base"], run_git=ForbiddenGit())
        with self.assertRaisesRegex(ValueError, r"\(arguments\): expected .* \| received: --base without a value"):
            eu.main(["--base", "--json"], run_git=ForbiddenGit())
        with self.assertRaisesRegex(ValueError, r"\(arguments\): expected .* \| received: --bogus"):
            eu.main(["--bogus"], run_git=ForbiddenGit())
        self.assertTrue(callable(eu.create_evidence().npm))

    def test_resolved_mapping_must_be_object_of_strings(self) -> None:
        directory = Path(tempfile.mkdtemp(prefix="skills-resolved-py-"))
        self.addCleanup(shutil.rmtree, str(directory), True)
        bad = directory / "bad.json"
        bad.write_text(json.dumps({"id": 5}))
        pattern = r"\(--resolved\): expected object of declaration IDs to exact version strings \| received: \{\"id\": 5\}"
        with self.assertRaisesRegex(ValueError, pattern):
            eu.main(["--resolved", str(bad)], run_git=ForbiddenGit())
        bad.write_text("[]")
        with self.assertRaisesRegex(ValueError, r"received: \[\]"):
            eu.main(["--resolved", str(bad)], run_git=ForbiddenGit())
        with self.assertRaisesRegex(ValueError, r"\(--resolved\): expected readable JSON file \| received: "):
            eu.main(["--resolved", str(directory / "missing.json")], run_git=ForbiddenGit())

    def smoke_repo(self) -> "tuple[GitFixture, str, str]":
        fixture = GitFixture(self)
        fixture.write("package.json", json.dumps({"dependencies": {"fixture": "^0.0.1"}}))
        base = fixture.commit("base fixture")
        fixture.write("package.json", json.dumps({"dependencies": {"fixture": "^1.2.3"}}))
        head = fixture.commit("feature fixture")
        return fixture, base, head

    def test_json_report_for_unresolved_range_exits_2_without_network(self) -> None:
        fixture, base, head = self.smoke_repo()
        lines: List[str] = []
        code = eu.main(
            ["--base", base, "--head", head, "--json"],
            evidence=FakeEvidence(),
            run_git=fixture.runner(),
            now_ms=lambda: CUTOFF + 3 * 86400000,
            out=lines.append,
        )
        report = json.loads("\n".join(lines))
        self.assertEqual(code, 2)
        self.assertEqual(report["head"], head)
        self.assertEqual(report["cutoff"], "2026-10-12T00:00:00.000Z")
        self.assertEqual(len(report["rows"]), 1)
        self.assertEqual(report["rows"][0]["declaration"], "^1.2.3")
        self.assertEqual(report["rows"][0]["current_evidence"]["status"], "unknown")
        self.assertEqual(list(report), ["base", "base_tip", "head", "rows", "uncovered", "cutoff"])

    def test_complete_report_exits_0_and_prints_text_lines(self) -> None:
        fixture, base, head = self.smoke_repo()
        directory = Path(tempfile.mkdtemp(prefix="skills-resolved-py-"))
        self.addCleanup(shutil.rmtree, str(directory), True)
        resolved = directory / "resolved.json"
        resolved.write_text(json.dumps({"package.json#dependencies:fixture": "1.2.3"}))
        metadata = metadata_for({"1.2.3": "2026-10-01"})
        evidence = FakeEvidence(
            metadata, {"repos/owner/repo/releases/tags/v1.2.3": {"status": "ok", "data": release("1.2.3")}}
        )
        lines: List[str] = []
        code = eu.main(
            ["--base", base, "--head", head, "--resolved", str(resolved), "--min-days", "3"],
            evidence=evidence,
            run_git=fixture.runner(),
            now_ms=lambda: CUTOFF + 3 * 86400000,
            out=lines.append,
        )
        self.assertEqual(code, 0)
        self.assertEqual(lines[0], "Cutoff: 2026-10-12T00:00:00.000Z")
        self.assertEqual(
            lines[1],
            "package.json#dependencies:fixture: ^1.2.3; current=1.2.3 (eligible); "
            "no-newer-stable-version; coverage=range; completeness=complete",
        )

    def test_uncovered_files_force_exit_2(self) -> None:
        fixture = GitFixture(self)
        fixture.write("README.md", "x")
        base = fixture.commit("base")
        fixture.write("Cargo.toml", "[package]")
        head = fixture.commit("rust")
        lines: List[str] = []
        code = eu.main(
            ["--base", base, "--head", head], evidence=FakeEvidence(), run_git=fixture.runner(), out=lines.append
        )
        self.assertEqual(code, 2)
        self.assertEqual(lines[-1], "Cargo.toml: unsupported-ecosystem")

    def test_cli_wrapper_returns_1_and_reports_errors_on_stderr(self) -> None:
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            code = eu.cli(["--invalid-option"])
        self.assertEqual(code, 1)
        self.assertIn("(arguments): expected", stderr.getvalue())
        self.assertIn("received: --invalid-option", stderr.getvalue())

    def test_script_entrypoint_exits_1_for_invalid_option(self) -> None:
        completed = subprocess.run(
            [sys.executable, "-I", str(HERE / "eligible_upgrades.py"), "--invalid-option"],
            capture_output=True, universal_newlines=True, check=False,
        )
        self.assertEqual(completed.returncode, 1, completed.stderr)
        self.assertIn("received: --invalid-option", completed.stderr)


def javascript_runtime() -> str:
    """Return the node or bun executable on PATH, or "" when neither exists."""
    return shutil.which("node") or shutil.which("bun") or ""


@unittest.skipUnless(JS_MODULE.exists() and javascript_runtime(), "needs eligible-upgrades.mjs and node or bun on PATH")
class JavaScriptParityTests(unittest.TestCase):
    """Cross-check helpers and the offline CLI against the JavaScript implementation."""

    YAML_SAMPLES = [
        "steps:\n  - uses:\n# comment\n      owner/action@v1.0.0\n",
        "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4 # pin\n      - uses: \"q/d@v1\"\n",
        "steps:\n  - run: |\n      uses: no/pe@v1\n  - uses: 'q/s@v2'\n  - { uses: f/l@v3, name: x }\n",
        "uses: ./local\nwith:\n  uses: n/ested@v1\nx: ${{ y }}\nuses: true\nuses: # nothing\n",
        "a:\n  - - uses: deep/list@v1\n# uses: comment/only@v1\n--- \nuses: after/doc@v1\n",
        "steps:\n  - uses: &co actions/checkout@v5\n  - uses: *co\n  - uses: !!str t/g@v1\n  - uses: &only\n",
        "? uses\n: actions/checkout@v5\n- ? \"uses\"\n  : *x\n? other\n: skip/me@v1\n",
        "uses: |\n  owner/block@v1\nuses: >-\n  o/f@v1\nuses: [a, b]\nuses: 'open\n  q@v1'\nuses: after/q@v1\n",
        "run: \"echo '{uses: evil/x@v1}'\"\nother: \"a, uses: evil@v1 {\"\nargs:\n  - |\n    uses: evil/y@v1\n"
        "run2: \"echo\n  uses: evil/z@v2\"\n- \"echo\n  uses: evil/w@v2\"\nx: {a: \"e, uses: bad@v1\"}\n",
        "- {name: a,\n   uses: o/a@v1}\n- {uses: *ref, name: z}\n- {uses: ${{ matrix.action }}}\n"
        "x: {a: [{uses: deep/n@v1}], uses: \"q/m@v2\"}\ny: [uses: r/s@v1]\n- {name: a, # note\n   uses: o/c@v1}\n",
    ]

    def run_js(self, source: str, cwd: Optional[Path] = None) -> str:
        directory = Path(tempfile.mkdtemp(prefix="skills-js-parity-"))
        self.addCleanup(shutil.rmtree, str(directory), True)
        script = directory / "run.mjs"
        script.write_text(source)
        completed = subprocess.run(
            [javascript_runtime(), str(script)], cwd=str(cwd) if cwd else None,
            capture_output=True, universal_newlines=True, check=False,
        )
        self.assertIn(completed.returncode, (0, 2), completed.stderr)
        return completed.stdout

    def test_extract_uses_and_satisfies_range_agree_with_javascript(self) -> None:
        specs = [("1.2.5", "^1.0.0"), ("0.0.4", "^0.0.3"), ("1.3.0", "~1.2.3"), ("1.2.3", "1.2.3"), ("1.0.0", "x")]
        script = (
            f'import {{ extractUses, satisfiesRange }} from {json.dumps(JS_MODULE.as_uri())};\n'
            f"const yaml = {json.dumps(self.YAML_SAMPLES)};\nconst specs = {json.dumps(specs)};\n"
            "console.log(JSON.stringify({uses: yaml.map(extractUses),"
            " ranges: specs.map(([v, s]) => satisfiesRange(v, s))}));\n"
        )
        result = json.loads(self.run_js(script))
        self.assertEqual(result["uses"], [eu.extract_uses(sample) for sample in self.YAML_SAMPLES])
        self.assertEqual(result["ranges"], [eu.satisfies_range(v, s) for v, s in specs])

    def test_offline_cli_json_matches_javascript(self) -> None:
        fixture = GitFixture(self)
        fixture.write("package.json", json.dumps({"dependencies": {"fixture": "^0.0.1"}}))
        base = fixture.commit("base fixture")
        fixture.write("package.json", json.dumps({"dependencies": {"fixture": "^1.2.3"}}))
        fixture.write("Cargo.toml", "[package]")
        fixture.write(
            ".github/workflows/ci.yml",
            "steps:\n  - uses: owner/other@v3\n  - uses: &co o/a@v5\n  - uses: *co\n  - {name: x,\n     uses: o/f@v1}\n",
        )
        head = fixture.commit("feature fixture")
        argv = ["--base", base, "--head", head, "--json"]
        js = subprocess.run(
            [javascript_runtime(), str(JS_MODULE), *argv], cwd=str(fixture.repo), env=fixture.env,
            capture_output=True, universal_newlines=True, check=False,
        )
        py = subprocess.run(
            [sys.executable, "-I", str(HERE / "eligible_upgrades.py"), *argv], cwd=str(fixture.repo),
            env=fixture.env, capture_output=True, universal_newlines=True, check=False,
        )
        self.assertEqual((js.returncode, py.returncode), (2, 2), (js.stderr, py.stderr))
        js_report, py_report = json.loads(js.stdout), json.loads(py.stdout)
        js_report.pop("cutoff")
        py_report.pop("cutoff")
        self.assertEqual(py_report, js_report)
        self.assertEqual(list(py_report), list(js_report))


if __name__ == "__main__":
    unittest.main()
