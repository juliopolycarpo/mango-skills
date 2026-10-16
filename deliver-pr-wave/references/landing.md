# Land a PR

Use this reference when merging is part of the request: one PR, an ordered wave, or a merge
train. The user's request names the merge; do not ask again, but do not merge past a failed gate.

## Read the merge state

Resolve live rules before trusting a status field. Rulesets hide from the classic branch
protection endpoint, so `.../branches/main/protection` can return 404 while rules apply. Read
`gh api repos/$repo_slug/rulesets` and applicable ruleset details, including bypass actors.

- `BLOCKED` can mean unresolved threads, missing approvals, strict up-to-date requirements,
  or other rules. Inspect applicable rules and feedback to identify the actual gate.
- Bypass capability does not establish permission to use it. Honor repository policy and task
  authorization; never infer an approval waiver from a green check set or account privileges.
  Do not bypass failing checks or unresolved actionable feedback.
- `CLEAN` on a PR stacked on a feature branch proves nothing: rulesets and most workflows only
  target the default branch. Check `baseRefName` and the checks again after retargeting.
- A cancelled, superseded run in the rollup is not a failure. Read the latest check run per
  name, and distinguish repeated check names by workflow and app. Several workflows can emit
  the same required name (for example `Gate`).
- Bot resolution behavior depends on repository configuration; verify `isResolved` instead of
  assuming. A declined thread still needs a reply and a resolution before merging.

## Squash merge

Read the final diff and recent base merge messages. Draft a Conventional Commit subject with
the repository's PR-number convention, preserving any breaking `!`, and a concise body
explaining final behavior and migration.
Use a unique branch-prefixed file and preserve legitimate contributor trailers. Hosted merging
does not run local Git hooks. If repository policy requires a sign-off and its attestation is
valid, generate it with `git interpret-trailers` from the effective `git config user.name` and
`git config user.email`, avoiding duplicate trailers. Verify the hosting service can meet
required signature policy before landing. Never invent identity or co-authorship. Follow the
[delivery guide](delivery.md#commit-and-publish) for disclosure and issue references.

Run `gh pr merge <n> --repo <slug> --squash --subject "<subject>" --body-file <file>
--match-head-commit <qualified-head-sha>`. Use admin bypass only when authorized repository
policy permits it and all substantive gates pass. Re-fetch `mergeCommit.oid` from the merged
PR, fetch that object and the reviewed head, and verify the actual commit's message, policy-required
signature, and trailers. Require one parent and ancestry on the fetched base. Compare its tree
with `git merge-tree --write-tree <actual-first-parent> <reviewed-head-sha>`, retaining independent
base changes. Conflicts or unavailable objects leave verification incomplete. Do not compare
only with the latest base tip or raw head tree. Report any mismatch. Rewriting a landed commit
requires separate authorization; never force-push merely to make verification pass.

## Preserve history with a merge commit

Record base, original head, and final qualified head. If the base is not an ancestor, merge it
into the umbrella and qualify the published result again; never rebase preserved history.
Audit carried signatures and committer sign-offs with the delivery guide. If existing commits
need rewriting, report the conflict with preservation and obtain authorization for that repair.

In a clean checkout of the recorded base, create a merge with
`git merge --no-ff --no-edit -F <branch-merge-message-file> <qualified-head-sha>`. Add `-S`
when signatures are required and `--signoff` when a valid DCO attestation is required. Verify
policy-required signatures and trailers, exactly two parents (recorded base and head),
original-head ancestry, and an empty
`git diff <qualified-head-sha> HEAD`. A changed tree needs fresh candidate validation.

For unrelated history, prepare with `--allow-unrelated-histories` in isolation and validate
that exact two-parent candidate, signed when policy requires it, including conflict resolutions.
Record its SHA,
parents, tree, and checks. Head-only CI does not qualify combined source; disclose unavailable
candidate workflows rather than claiming they passed.

Immediately before landing, fetch and require both remote refs to equal the qualified SHAs.
If either moved, repeat preparation and qualification. Push the exact candidate as an ordinary
fast-forward `git push <base-remote> HEAD:<base>`, never force. A rejection requires inspecting
live state. Re-fetch, verify the actual merge is on the base, and confirm the PR is merged.
GitHub rebase merge rewrites identities and is unsuitable for preserved history.

## Stacked PRs

When a parent lands by squash, obtain its final `headRefOid` from the parent PR, even if its
branch was deleted. Record the child's old head and remote head. Recover the actual old parent
boundary incorporated in that child's history from a recorded boundary, recovery ref, or
reflog. The parent's final head may have been rewritten since the child branched; do not use
it as the boundary unless ancestry and inspection prove it is the last incorporated parent
commit. A merge-base with the rewritten parent does not establish that boundary.

Verify `git merge-base --is-ancestor <old-child-boundary> <old-child-head>` succeeds and inspect
`<old-child-boundary>..<old-child-head>` for only intended child work. If the boundary is
unknown, preserve the branch and report the missing evidence. Replay with
`git rebase --onto <fetched-new-base> <old-child-boundary>`. Compare old and new feature ranges
with `git range-diff`, inspect changed or dropped patches, and verify parent changes removed
during review remain absent. Review upstream contract changes and validate. Retarget the
child PR, publish to its actual head ref with the recorded exact lease, and wait for fresh
default-base checks before merging.

## Merge train

Use a train when a ruleset forces up-to-date branches, so only one PR can merge at a time.

- Serialize: update the branch, wait for current-head checks, merge, then take the next. Prefer
  `gh pr update-branch`. It is refused for PRs that touch `.github/workflows/*` when the token
  lacks the `workflow` scope; merge the base locally and push those, and queue them first or
  last.
- Bound scripted train batches and watch duration to the current runner and tool limits.
  Stop or report a unit on conflicts, failed gates, or unresolved threads; continue independent
  units only when ordering and authorization allow it.
- Use REST for PR state, and read only the latest check run per name.
- Create each squash message from its final diff using the local squash workflow; preserve
  policy-required sign-offs and legitimate contributor trailers.
- Reviews can arrive after CI goes green, and a bot may post a late finding. Re-check threads
  immediately before each merge.
- Merge agents go idle when their CI watch expires. Compare open PRs' check state with the
  running agents and resume any agent whose PR is green.
- Diagnose queued or repeated failures from live run state and logs. Prefer supported rerun
  or cancellation controls within scope. Do not rewrite history merely to trigger CI; any
  branch update needs authorization, an exact lease when rewritten, and fresh qualification.

## After landing

Re-fetch each merged PR, confirm the merge commit and checks on the base, delete task-created
branches and worktrees only when in scope, and leave owner-reserved steps pending. Update the
project tracker, when applicable, with the merge commit.
