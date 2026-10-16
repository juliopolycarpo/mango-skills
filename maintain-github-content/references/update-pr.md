# Update pull requests

Use for titles, descriptions, validation evidence, and authorized triage metadata.

## Inspect the current change

Resolve the named PR or the current branch's PR with live GitHub data. If none exists,
report that; create one only when requested. Record the URL, base, head SHA, draft state,
title/body, labels, assignees, reviewers, milestone, and project membership as relevant.
Read commits, changed files, and the actual diff. Paginate file and commit APIs when a
summary is capped. A local checkout or changed-file list alone cannot establish behavior.

Read relevant conversation comments, submitted reviews, every review-thread page, and
all comments in relevant threads. Inspect checks and receipts for the current head.
Separate hosted checks, local runs, manual testing, native validation, and historical
measurements. A prior run needs its SHA, environment, and limitation. Metadata maintenance
does not require running tests or fixing code.

## Find and preserve the template

Read contribution and title rules from the current base, using freshly fetched content.
Search case-insensitively in this order:

1. `.github/PULL_REQUEST_TEMPLATE.md`
2. `docs/PULL_REQUEST_TEMPLATE.md`
3. `PULL_REQUEST_TEMPLATE.md`
4. `.github/PULL_REQUEST_TEMPLATE/*`
5. `docs/PULL_REQUEST_TEMPLATE/*`
6. `PULL_REQUEST_TEMPLATE/*`

For multiple templates, use the selected template or the one matching the current headings.
If ambiguous, inspect repository defaults and ask only when the choice affects required
content. Preserve required headings and checkbox lists. Fill sections and remove completed
instructional placeholders. Explain N/A. Without a template, describe the problem, result,
validation, and relevant risks or follow-ups without inventing extra sections.

## Rewrite and triage

Lead with the concrete trigger and resulting behavior. Scale detail to the diff. Include
material migrations, flags, compatibility changes, documentation, and remaining work.
Keep the title short and aligned with repository conventions and final scope. If
Conventional Commits apply, retain `!` for a breaking change and explain the migration.

Preserve valid measurement receipts with their original SHA and conditions. Change numbers
only from new measurements. Correct or remove inaccurate table rows and stale prose using
source evidence, including nonmeasurement matrices. Leave unperformed checks unchecked;
a focused pass or older head cannot establish current full-suite readiness. Keep advisory
failures and pending acceptance work visible.

Verify related issues directly, including closed and cross-repository issues. Use
`Fixes #N` only when the full issue scope is addressed and repository policy permits a
closing reference; use `Ref #N` for partial work. Remove incorrect references.

When triage is authorized, reconcile labels, assignees, milestones, and project fields with
live definitions. Request reviewers or change draft state only when covered by the task;
these actions can trigger notifications and automation. Do not infer readiness from age,
a title, or a green badge without checking the tested SHA and required checks.

## Save and verify

Use the common read-before-write and readback workflow in
[the entrypoint](../SKILL.md#maintenance-workflow). Compare the saved title and body exactly;
verify metadata changes and confirm the head SHA. If a new head invalidates claims, audit
it before reporting the PR content as current. Report the URL and concise change summary.
