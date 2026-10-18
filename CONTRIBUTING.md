# Contributing

Report a skill failure with the skill name, agent and tool versions, the task you tried,
expected behavior, actual behavior, and a minimal reproduction. Remove credentials and
private repository content. Suggest a skill or improvement with a concrete workflow and
an example of the result it should produce.

## Make a change

1. Keep the change within one concern. Read the affected skill, its references, and helpers.
2. Preserve standalone installation. Bundle required resources in that skill's directory;
   follow the consuming project's tools and policies rather than personal setup assumptions.
3. Put conditional detail in references. Add a helper only when deterministic execution adds
   value. Keep JavaScript and Python implementations compatible and test both. Keep tests in
   the repository's `tests/` directory so skill installations contain only runtime resources.
4. For behavior fixes, show the intended failure before the fix and a pass afterward. Exercise
   Git and release workflows in isolated fixtures; do not mutate live services as a test.
5. Run the checks below. In your PR, explain the problem, resulting behavior, validation,
   and anything unverified. Include source and license notices for adapted work.

## Checks

Use Bun 1.4.3, Node 24 for helper compatibility checks, Python 3.9 or newer, and Git
with `merge-tree --write-tree` support.

```bash
bun install --frozen-lockfile
bun run check
bun run test:node
```

Individual commands are `bun run validate`, `bun run package`, `bun run test`,
`bun run test:python`, `bun run smoke`, and `bun run format:check`. Format with `bun run format`.
`bun run package` builds the plugin ZIPs into the ignored `dist/` directory and validates
the archives; pass `-- --version 1.2.3` to set the version (default `0.0.0`).
The helper smoke uses synthetic Git history and named fakes, with no registry or GitHub
requests. CI runs the full checks on Linux and Windows with Python 3.9 and 3.13,
and exercises the JavaScript helpers under Node 24 as well as Bun.

Helper suites live in `tests/<skill>/javascript/` and `tests/<skill>/python/`; repository
checks and Git workflow scenarios live directly in `tests/`. Tests import the helpers from
their skill directories. Run one skill's no-network suites from the repository root, for example:

```bash
bun test ./tests/dependabot-rollup/javascript
python3 -I -m unittest discover -s tests/dependabot-rollup/python
```

Keep repeated readiness documents and shared GitHub query sections identical. The repository's
`tests/shared-guidance.test.mjs` checks these copies; update each copy together. The complete
copies stay inside their skill directories so installed skills need no sibling resources.

Use Conventional Commit subjects such as `fix(rebase-pr): preserve the recorded remote head`
and a body describing why the change is needed. Follow any additional contribution policy
adopted by the repository. Keep source attribution with each independently copied skill.

## Releases

Every release covers the whole repository with one version. A release is due when a merge to
`main` changes the packaged payload: any file in a skill directory, `LICENSE`, the bundle icon,
or packaging code that changes archive contents. Changes to tests, CI, and repository docs such
as this file never make a release due, whatever the commit type.

The version starts at 0.1.0. Each release bumps the patch, or the minor when a commit since the
last release has `!` before its subject colon or a `BREAKING CHANGE:` footer. The major does not
change.

After Check passes on `main`, the Release candidate workflow keeps one draft release for the
next version, with the archives, `SHA256SUMS`, `release.json`, and the command that publishes it:

```bash
git tag -s vX.Y.Z <sha> -m "mango-skills X.Y.Z" && git push origin vX.Y.Z
```

Only the owner can push the signed tag. The Release workflow then checks that GitHub verified
the tag signature and that the commit is on `main` and passed Check. It recomputes the plan,
rebuilds and validates the archives, publishes the draft, and verifies the downloaded hashes.
It does not reuse the draft's files. Published releases are immutable; a rerun only verifies
the release. Drafting and publishing share a concurrency group, and GitHub replaces a queued
run when another one queues behind it, so rerun the Release workflow if its tag run was
cancelled while waiting. Tagging an older commit than the draft's source publishes that
commit; the newer changes get a draft on the next push to `main`, or when you re-run the latest
Release candidate run. Run `bun run release plan --sha HEAD` to preview the decision locally.
