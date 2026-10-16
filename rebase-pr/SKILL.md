---
name: rebase-pr
description: "Use to rebase or restack a branch or PR, resolve base conflicts, and review interactions with upstream changes."
---

# Rebase a PR

Finish the requested replay, review, validation, and follow-up at the resulting head.
Preserve the target and existing authorization. A local rebase may end locally; a PR refresh
includes its remote update when requested. Neither authorizes merging or an unrelated PR.

Typical request: "rebase this branch onto main and code-review it; look for gaps or
opportunities the rebase opens and apply all follow-ups to this PR (#N)". That means every step
below, including a clean replay, through the PR body refresh, and stops short of merging.

## Workflow

1. Resolve the live PR, head/base repositories, branches, and fetch/push remotes. Do not assume
   `origin` or `main`. Inspect status, worktrees, and local/remote differences. Use a clean
   checkout without resetting or stashing someone else's work.
2. Fetch the intended refs. Record original local head, observed remote head, feature
   boundary, and new base SHA. Create a recovery ref. Fresh checkouts must start at the
   intended head and receive only missing setup.
3. Inspect upstream changes since the old base, including squashes. Trace overlapping
   contracts, callers, tests, build scripts, dependencies, and artifacts before replaying.
   For stacks or squash-merged parents, read [replay details](references/replay.md).
4. Rebase the intended commits. Resolve conflicts to preserve both branches' required
   behavior. Inspect callers and tests instead of choosing a whole side blindly; regenerate
   artifacts with repository tooling.
5. Use `git range-diff` to compare feature ranges, excluding landed parent work. Inspect
   changed or dropped patches and explain intentional differences.
6. Audit even after a clean rebase. A conflict-free replay can still break new upstream
   contracts: review the final diff against the new base and adjacent behavior, then do a
   code review of the rebased range. Look for gaps (callers, tests, docs, generated files,
   configuration the upstream change now affects) and opportunities the rebase exposed, such
   as code that can reuse a new upstream helper or a workaround upstream made redundant.
   Apply follow-ups that are small, supported by evidence, and scoped to what the rebase
   exposed. Track anything larger or unrelated instead of folding it in.
7. Verify repository-required signatures and sign-offs on recreated commits, following
   [signing and hosted follow-up](references/follow-up.md#verify-recreated-commits). Use Git
   identity and normal Git signing/sign-off flags as required. Retain recovery refs if signing fails.
8. Run targeted checks, then required repository gates. Record commands, results, and tested
   SHA. Fix replay or follow-up failures; later changes require affected validation again.
9. When the requested outcome includes pushing, use an exact lease against the recorded
   remote SHA. Read [push details](references/replay.md#push-with-an-exact-lease). Re-fetch and
   confirm the PR head. After a lease failure, inspect remote changes; do not retry by merely
   replacing the expected SHA or removing the lease.
10. For a PR request, refresh title and body after the final push from the current diff, base
    template, and validation evidence, following the [metadata steps](references/follow-up.md#refresh-pr-metadata).
    Include interaction findings and follow-up commits. Redo it if later work changes the head.

## Completion

Report original/final heads, base SHA, replay differences, interaction findings, exact
validation results, and local status. Distinguish a validated local replay, a pushed branch,
and readiness. Keep recovery refs and a next step if interrupted.

For requested readiness, complete the [readiness cycle](references/follow-up.md#check-requested-readiness)
for current-head checks, comments, every review-thread page, and merge state. Merge authorization is
separate from readiness: a rebase, review, or green PR does not by itself permit merging.
Report pending CI and unperformed manual/platform checks; leave owner-controlled PRs unmerged
unless merging was requested.
