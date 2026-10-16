# Update pull requests

Use for titles, descriptions, validation evidence, and authorized triage metadata.

## Inspect the current change

Resolve the PR from live GitHub data and read its current title, body, and requested fields.
If none exists, report that; create one only when requested.

- For a focused edit, inspect only the context needed to verify the affected claim. A title
  correction does not require a full review or CI audit.
- For a full refresh, record the base and head SHA; inspect commits, files, the diff,
  relevant conversation, reviews, and current-head checks. Paginate relevant collections,
  including comments within threads. Include resolved discussions when they explain decisions
  or completed fixes. A changed-file list alone cannot establish behavior.

Keep historical receipts tied to their SHA and environment. Metadata maintenance does not
require running tests or fixing code.

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

Describe the problem and resulting behavior, including migrations and remaining work.
Align the title with final scope and repository conventions; retain `!` for breaking changes
when Conventional Commits apply.

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
