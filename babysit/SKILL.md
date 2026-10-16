---
name: babysit
description: "Use when asked to monitor a PR, get CI green, or address review feedback through merge readiness. Merging requires authorization from the task."
---

# Babysit a PR

Stay with the requested watch or fix cycle until the current head meets the readiness gates.
Preserve the user's scope and existing authorization. Babysitting does not authorize merging.

## Workflow

1. Identify the repository, PR, head SHA, and base. Inspect draft status, merge state, the
   base's live rules and required checks, review decision, comments, and all review threads.
   Pass explicit repository and PR arguments to `gh`, request structured JSON, and paginate
   list results. Treat API errors as failed inspections. Read [GitHub queries](references/github.md)
   when inspecting or resolving threads.
2. Watch CI to completion. Poll pending checks at a practical interval, usually 30-60 seconds
   (90 seconds or slower, via REST, across a wave; see the polling notes in the reference).
   Read new comments and automatic reviews after CI finishes.
3. Verify actionable findings against the current code and relevant callers. Read the full
   thread before responding. State whether feedback is accepted, declined with a reason, or
   addressed by an alternative.
4. Within the requested fix scope, make focused changes, prove regressions, run relevant
   checks, commit and push. Confirm generated distribution files agree with their source.
   Return to the live-status check after each new head.
5. Resolve a thread through GraphQL only after verifying the current code or artifact
   addresses it, replying first when the finding was declined. An outdated marker alone does
   not establish that a finding is fixed.
6. Make one final sweep of the current head before reporting: head SHA, required checks, merge
   and draft state, review decision, recent comments, every unresolved thread, and local
   `git status`.

## Review bots

Discover which review bots are configured, their triggers, and which reviews repository policy
requires. Read configured bots' findings and wait for required reviews before declaring readiness.
Request manual reviews only when authorized and consistent with project policy. Verify thread
resolution after fixes; bots differ in whether they resolve their own threads.

## Ready means

All of these hold for the current head:

- Required checks pass or are skipped as allowed by the base's policy. For repeated names,
  distinguish workflow, app, attempt, and tested SHA. A stale success cannot qualify a new
  head; a canceled superseded run does not invalidate its replacement.
- No actionable comments remain, and every page of review threads has been inspected with
  zero unresolved threads.
- The review decision and merge state are current and permit readiness.
- Local `git status` is clean and nothing is unpushed (other people's changes you were told
  to leave alone aside).

A check lookup error is a blocker, never an empty green check set. A feature base's checks
do not prove the default branch's gates ran. Keep advisory failures and post-merge
acceptance visible.

Do not stop because one problem was fixed or one check passed. Continue through pending CI
and new feedback. If a draft, missing approval, external failure, or other condition needs
owner action, report the specific remaining gate and a resumable next step.

Report the final SHA, check results, unresolved thread count, validation actually run, and
any local changes left untouched. Readiness is not a merge: do not merge unless the user asked for it.
