# Upgrade commits, publication, and readiness

## Commit and publish

Read repository instructions, commit rules, hooks, recent base commits, and the intended diff.
Use `type(scope): description`, with optional scope, and a body explaining the problem and
result. Wrap prose at 72 columns unless repository rules differ. Preserve `!` and a
`BREAKING CHANGE:` migration footer for broken supported contracts. Split unrelated concerns.
Write each message to a unique branch-prefixed file and run `git commit -F <file>` with hooks
enabled. Read identity from `git config user.name` and `git config user.email`. Follow the
consuming repository's signing and DCO policy: use `git commit -S` when signatures are required
and `git commit -s` when a sign-off is required and its attestation is valid. Use both flags
when both apply, and preserve contributor attribution.

Inspect newly created commits with
`git log --format='%h|%G?|%(trailers:key=Signed-off-by,valueonly,separator=;)' <base>..HEAD`.
Verify signatures and sign-offs required by repository policy; do not require them where no
such policy applies. Missing trust information is not successful signature verification.
Message-only repairs must preserve tree IDs and
exclude staged content. Never bypass a hook or rewrite unrelated history.

Before posting GitHub text, follow the repository's disclosure and issue-reference rules.
Remove secrets, private planning details and irrelevant local paths. Use issue-closing keywords
only when the change fully resolves that issue; otherwise use a non-closing reference.

Publish only within task authorization. Resolve the actual head repository, remote and branch,
including forks. Record its remote SHA before rewriting. A rewritten branch uses
`git push --force-with-lease=refs/heads/<branch>:<observed-sha> <remote> HEAD:refs/heads/<branch>`.
If refused, inspect new remote work and reconcile it; never replace the lease with force.
Re-fetch the PR and confirm its head equals the pushed SHA.

## PR metadata and follow-ups

Read the current base's PR template, contribution rules, final diff, commits, and validation
receipts. Preserve every template heading, checkbox list, and useful evidence table. Describe
the problem and resulting behavior. Separate current-head hosted checks, local checks,
historical receipts, and unperformed native or manual checks. Keep unchecked work unchecked.
Write a branch-prefixed body file and use `gh pr create` or `gh pr edit` with explicit
`--repo <slug>` and `--body-file <file>` as authorized. Re-fetch and compare the saved title,
body, and head with the intended text and evidence; reconcile intervening owner edits.

Search for duplicate follow-ups first. Use the project's designated tracker and issue templates,
recording scope, evidence, validation gaps, blockers, and relevant links. Create follow-ups only
within task authorization and report every issue filed.

## Bring the current head to readiness

Resolve the live repository, PR, head, base, draft status, review decision, merge state, and
base rules. Use explicit repository and PR arguments. Query status with
`gh pr view <n> --repo <slug> --json headRefOid,baseRefName,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup`.
Read required checks from live rules, including rulesets. Query failures block readiness.

Watch checks to completion and inspect fresh human and automatic reviews afterward. For a
wave, use one poller with paginated REST check runs and commit statuses at 90 seconds or slower;
keep GraphQL for review threads. Distinguish tested SHA, workflow, app, run attempt, and latest
replacement when names repeat. For `gh pr checks --json`, require a successful lookup and
inspect every check bucket; exit 0 does not mean the checks passed. With tabular output,
exit 8 means pending checks. Download completed-job logs through
`gh api repos/<slug>/actions/jobs/<id>/logs`, including while other jobs in the run continue.
Use the Actions web UI for running-job output; unavailable logs do not establish job failure.

Inspect conversation comments, reviews, and every page of GraphQL `reviewThreads(first:100,
after:$cursor)` on the pull request. For each page require no GraphQL errors, a non-null
connection, and a valid end cursor when `pageInfo.hasNextPage` is true. Fetch all pages of an
actionable thread's `comments` before deciding. `gh pr view --json comments,reviews` omits
inline threads. Read findings against the current code and callers; accept, decline with a
reason, or explain an alternative fix. Within authorized scope, fix, prove the expected
regression failure before the fix, run required checks, commit, push, and repeat at the new SHA.

Reply with GraphQL `addPullRequestReviewThreadReply` or REST
`repos/<slug>/pulls/<n>/comments/<comment-id>/replies`, using `-F body=@<reply-file>` for file
input. Resolve only verified fixes with GraphQL `resolveReviewThread(input:{threadId:$id})`;
re-fetch to confirm. An outdated line alone does not prove a fix. Discover which review bots
are configured and which reviews repository policy requires. Wait for those reviews at their
configured trigger, and inspect late findings before declaring readiness. Request manual bot
reviews only when authorized and consistent with project policy.

Ready requires current-head checks passing or policy-allowed skips, zero unresolved threads,
no actionable feedback, permitted review/merge state, and no task-owned dirty or unpushed work.
A feature base's checks do not qualify default-branch landing. Keep advisory failures and
post-merge acceptance visible. Repeat the final head, checks, comments, threads, draft/review
state, and local-status sweep immediately before landing or handoff. External blockers need
an exact remaining gate and resumable next step; readiness alone does not authorize merging.
