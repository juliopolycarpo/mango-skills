---
name: deliver-pr-wave
description: "Use for multi-stage PR delivery or coordinating multiple or dependent PRs through the requested commit, publication, review, and landing steps."
---

# Ship a PR or deliver a PR wave

Carry each unit to the requested destination. Preserve authorization already given and any
steps reserved for the owner. A request for review-ready PRs does not authorize merging;
integration into an umbrella does not mean the changes shipped. A request that names
squash or merge ("...then squash/merge") authorizes that merge once the gates below pass.

## Ship one PR

Typical request: "commit changes (split by concern/intent), push, update the PR body, open
issues for skipped follow-ups, then squash/merge". Run these in order and stop at the last
step the request covers.

1. Inspect status and the diff. Include only intended files and preserve other people's work.
   Split commits by concern with bodies, hooks enabled, and repository-required signatures and sign-offs, following the local
   [commit, publication, and readiness guide](references/delivery.md).
2. Run required checks for touched areas. Publish to the verified head remote and branch only
   within scope; use an exact lease for rewritten history and verify the hosted head.
3. Open a PR when requested, then refresh its title and body from the current base template,
   final diff, and actual validation evidence. Verify saved metadata and unchanged head.
4. Search for duplicate follow-ups and route deferred work to the project's designated tracker.
   Follow repository disclosure and issue-reference rules.
5. Bring the current head to readiness using the local guide: required checks complete,
   actionable bot and human feedback addressed, and every review thread resolved.
6. When merging is requested, verify the [landing gates](references/landing.md), use a curated
   squash for feature PRs or a merge commit with policy-required signing for preserved history, and verify the actual
   integration commit. Otherwise report readiness and stop.

## Map and assign a wave

1. Map each unit's concern, owned files, shared contracts, dependencies, branch point, target,
   validation, and owner. Count lockfiles, generated output, tests, and CI as possible overlaps.
2. Confirm targets from the request and current plan. Separate independent work from units that
   need an earlier change. Assign one coordinator for shared edits and integration.
3. For delegated work, use the [coordination reference](references/coordination.md) to prepare
   bounded briefs, isolated worktrees, resource budgets, scratch paths, and polling ownership.
   Delegate only when parallelism helps; do not give concurrent writers the same branch or
   shared lockfile.

## Implement and review

Verify each worktree's branch, head, and intended base before editing. Preserve intended local
commits and run only missing setup. Complete focused validation and required repository checks,
then review behavior and upstream interactions at the actual unit head. Delegate defect review
when an independent pass helps assess the change's risk and delegation is permitted. Wait for
every requested agent and review result before declaring that unit complete.

Coordinate hosted checks across the wave. Evaluate the current SHA, workflow, and run attempt;
superseded checks or historical environment failures do not establish current readiness. Use
the [readiness guide](references/delivery.md#bring-the-current-head-to-readiness) when the task includes reaching merge readiness.

## Integrate in order

Integrate authorized units one at a time in dependency order, using the
[landing guide](references/landing.md) for merge state, merge method, merge trains, and stacked
PRs. Immediately before each action, verify the source head, destination, permitted method, and
current readiness. Protect the checked head with `--match-head-commit`. After the target
advances, inspect interactions and repeat affected validation before the next integration.

For default-branch landing, check live rules, required checks, review threads, and merge state.
Record source and integration commits for umbrella work and leave owner-reserved steps pending.
For requested replay, establish the exact old feature boundary, retain a recovery ref, replay
onto the fetched base, inspect `git range-diff`, and review affected upstream contracts before
validation and an authorized exact-lease push. Preserve umbrella identities by merging the base
into the umbrella instead of replaying its commits.

## Handoff

Report each unit's branch/head, target, PR URL, integration or merge commit, validation, opened
follow-up issues, and remaining work. Distinguish local implementation, publication, umbrella
integration, and landing. Update the project tracker when applicable, including unperformed platforms and reserved
decisions.

Stop task-owned processes. Remove task-created worktrees only when their work is recoverable
and cleanup is in scope. Identify unpushed commits or dirty files that must be retained.
