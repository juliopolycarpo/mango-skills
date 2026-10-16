# Signing and hosted follow-up

## Verify recreated commits

Probe active tools with `type -a git gh`. Read `git config user.name`, `git config user.email`,
`git config --get commit.gpgsign`, and `git config --get gpg.format`. Use the effective Git
identity and repository policy; never override identity, expose signing material, or bypass
hooks. Use `git rebase --gpg-sign` when signatures are required and `git rebase --signoff` only
when required DCO attestations are valid. Preserve existing contributor attribution.

Inspect the recreated range after the final replay:

```bash
git log --format='%h|%G?|%cn <%ce>|%(trailers:key=Signed-off-by,valueonly,separator=;)' "$new_base..HEAD"
git show --format=fuller --stat HEAD
```

Verify each new commit meets the consuming repository's signature and sign-off rules,
preserving legitimate contributor sign-offs. Do not impose signing or DCO where no policy applies. Distinguish missing/invalid signatures from
missing verifier trust; a signature header alone is not verification. Repair through configured
Git tooling only within the authorized range and retain recovery refs on failure. Message-only
repairs must preserve tree IDs and exclude staged content. Revalidate the final range before
an authorized push with an exact lease.

## Query the live PR

Use explicit `--repo "$repo"` after discovery and structured `--json` fields. Resolve head and
base before acting, including fork ownership:

```bash
gh pr view "$number" --repo "$repo" --json url,title,body,headRefOid,headRefName,headRepository,headRepositoryOwner,baseRefName,isDraft,reviewDecision,mergeStateStatus
gh pr checks "$number" --repo "$repo" --required
gh api --paginate "repos/$repo/issues/$number/comments"
gh api --paginate "repos/$repo/pulls/$number/comments"
```

Lists have caps: set explicit limits and verify completeness. Inline comment REST results do
not establish review-thread resolution. Query GraphQL `repository.pullRequest.reviewThreads`
with `first: 100, after: $cursor`, selecting `nodes { id isResolved isOutdated }` and
`pageInfo { hasNextPage endCursor }`; repeat with the returned cursor until all pages are read.
Paginate comments within threads too. Use installed `gh --help` and API schemas for unsupported
fields; do not interpret an authentication, query, or check lookup failure as an empty result.

## Refresh PR metadata

Read the current title/body, commits, files, actual diff, and evidence at the final head. Load
the template from the current base, checking `.github/PULL_REQUEST_TEMPLATE.md`,
`.github/pull_request_template.md`, root/docs variants, and template directories. Follow
contribution/title rules and preserve all template headings, checkboxes, and existing evidence
tables. If several templates apply, use the one matching the change; without a template,
write the problem/result, validation, and material risks or migrations.

Keep title and description aligned with the final implementation, including any breaking
migration and required `!`. Mark only proven checks complete. Separate current-head hosted CI,
local validation, historical receipts with their original SHA/environment, and unperformed
native/manual checks. Verify issue scope before using `Fixes #N`; use `Ref #N` for partial work.
Follow repository disclosure and issue-reference rules. Remove secrets, private planning details,
and irrelevant local paths from the exact title and body before posting.

Write the exact body to a unique task file. Re-fetch before editing and reconcile head changes
or owner edits. Apply the edit and verify saved text and unchanged head:

```bash
gh pr edit "$number" --repo "$repo" --title "$title" --body-file "$body_file"
gh pr view "$number" --repo "$repo" --json title,body,headRefOid
```

Command success alone is not read-back verification. A later head requires refreshed evidence
and metadata. Do not create another PR or merge as part of a metadata refresh.

## Check requested readiness

Read the base's live rules and required checks. Watch pending CI at practical intervals,
usually 30–60 seconds. Inspect comments, review decisions, all review-thread pages, draft and
merge state. Match check results to the current head, workflow, app, and attempt; historical
success does not qualify a new SHA. Keep advisory failures and post-merge acceptance visible.

Verify actionable findings against current code and adjacent callers. Apply scoped authorized
fixes, prove any regression against faulty behavior and the fix, run affected and required
checks, then commit/push only when authorized. Repeat the cycle after every new head. State
whether feedback is accepted, declined with a reason, or addressed by an alternative. Resolve
threads through GraphQL `resolveReviewThread` only after current code addresses them; reply
with the rationale before resolving declined findings. An outdated marker alone is insufficient.

Discover configured review bots and required reviews from repository policy. Read their findings
and wait for required reviews at their configured triggers before declaring readiness. Request
manual bot reviews only within authorization and project policy.

Before reporting readiness, re-fetch head, required checks, merge/draft state, review decision,
recent comments, and every unresolved thread. Inspect local status and unpushed work. Required
checks must pass or be skipped as the base policy permits; unresolved actionable findings,
missing approvals, or unavailable checks remain explicit blockers with a next action. Preserve
other people's local work and keep owner-controlled PRs unmerged without merge authorization.
