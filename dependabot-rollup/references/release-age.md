# Release-age sweep

Run the read-only [eligible-upgrades helper](../scripts/javascript/eligible-upgrades.mjs) from the target
repository. Resolve `skill_dir` from this skill's supplied location:

```bash
bun "$skill_dir/scripts/javascript/eligible-upgrades.mjs" --base origin/main --head HEAD --min-days 3 --json
```

`node` runs the same script, and the [Python port](../scripts/python/eligible_upgrades.py) takes the
same options: `python3 "$skill_dir/scripts/python/eligible_upgrades.py" ...`.

Replace the base and age with repository policy. Without a repository-specific rule, use three
days and a formal, non-draft, non-prerelease GitHub release. The helper requires Bun, Node, or Python 3.9+,
plus Git and an authenticated `gh`; it changes no dependencies, refs, worktrees, or remote state. An inventory
request is read-only; apply changes when the task already authorizes them.

## Coverage and exact versions

Discovery compares the merge-base and head manifests structurally, including renamed and copied
files. Renames compare against the original path; copies introduce declarations at their new path.
Each added or changed npm declaration keeps its manifest path, dependency section, name, previous declaration, declared
range, package alias target, and exact version being assessed. A package's own `version` and
`engines` fields are excluded. Deleted declarations need no upgrade assessment.

An exact stable declaration supplies its own assessed version. For `^` and `~` ranges, obtain
the actual installed version from the target repository's lockfile or package-manager evidence;
never treat the range's lower bound as the installed version. Pass a JSON mapping with
`--resolved path/to/resolved.json`, keyed by the declaration's reported `id`:

```json
{
  "apps/web/package.json#dependencies:example": "1.2.3",
  "package.json#devDependencies:alias": "2.1.0"
}
```

Resolved versions must satisfy the declared range. npm aliases such as
`npm:@scope/package@^1.0.0` retain their declared name and query the target package. Preview
versions, dist-tags (`latest`, `next`), and unsupported declarations (`workspace:`, URLs,
complex ranges) remain visible with unknown eligibility. Review those channels separately;
this helper does not change preview or range policy. Stable candidates are reported across
major boundaries for npm; decide compatibility, holds, and allowed ranges before applying any.

YAML `uses` discovery compares declaration occurrence counts: each old occurrence suppresses
one matching new occurrence, so added duplicates and a step adopting a pin already used by
another step remain covered. Pure reordering with unchanged counts adds no rows; this is an
inventory comparison rather than step-identity tracking. Rows keep their new document index.

Changed declarations include direct exact action tags and SHA pins with exact version
comments. SHA version evidence requires one declaration occurrence and one unambiguous
source line containing only that `uses` value; repeated declarations or ambiguous source
text remain unknown for manual review. For SHA pins with usable comments, the helper verifies
that the comment's exact tag resolves to the pinned commit. Current release evidence must match
the exact assessed Git tag, including its `v` prefix; `1.0.0` and `v1.0.0` are distinct refs.
Actions candidates stay on that assessed
major. Major-only tags, local actions,
container actions, and other unsupported forms appear in coverage instead of disappearing.
Discovery reads `uses:` values without a YAML parser: block-style and explicit `? uses` keys,
quoted and plain values, `&anchor` and `!tag` prefixes, and single-line or multi-line `{...}`
flow mappings. A `uses` value it cannot read (an `*alias`, block scalar, flow collection,
unclosed quote, or bare anchor or tag) is listed as an unsupported declaration with its raw
text, so the run exits 2 and you review it by hand. A blank inline `uses:` value retains its
indented continuation as unsupported `uses:` text, including when that continuation changes
between revisions. Multi-line plain scalars are not resolved.
Changed Cargo, Docker, Python, and Go manifests are listed as uncovered; this is a changed-file
sweep, not a complete installed-dependency or transitive audit. Check platform subpackages and
other ecosystem formats separately.

## Evidence and results

The helper pins both input refs to commit SHAs once, before comparison or file reads. The JSON
object includes the merge-base SHA (`base`), pinned input base tip (`base_tip`), pinned `head`,
cutoff, rows, and uncovered paths. Concurrent ref updates cannot change the assessed snapshot. Each row
reports `current_evidence`, candidates with individual evidence, `completeness`, and a
`recommendation`. The current version must meet the same age and release policy as candidates.
Both registry publication and GitHub release publication must predate the cutoff. Missing or
invalid timestamps, absent current releases, missing repository metadata, failed requests, and
incomplete listings produce `unknown` evidence, never an age-policy pass.

GitHub 404 responses are distinct from authentication, rate-limit, network, or parse errors.
For npm, only successful 404 responses across the documented tag patterns establish “no GitHub
release”; unsupported tag conventions need manual evidence. Actions releases are paginated
through the last page. npm candidates are checked newest first through the first eligible
version; lower versions need no further lookup. A higher candidate with unknown evidence keeps
the highest-eligible recommendation unknown, even if a lower eligible version was found.
Preview versions encountered in registry metadata are named in `preview_versions`.

`no-newer-stable-version` describes the available stable version list;
`no-eligible-newer-version` means newer versions exist but fail policy. Neither means the
current version passed: read `current_evidence` and `completeness` too. Exit 0 requires complete
covered evidence and an eligible current version for every changed declaration. Exit 2 means
unknown coverage/evidence or an ineligible current version; exit 1 means invalid input or a
fatal inventory failure. An empty changed-dependency inventory may exit 0; it makes no claim
about unchanged dependencies.

Record publish times, eligible candidates, too-new versions, missing evidence, and any accepted
exception. Use the repository's one-invocation override for an explicitly accepted young
version, preserving persistent policy and the scope of existing exceptions.
