---
name: update-pr-body
description: "Use to refresh a PR title and description from its current diff, base template, and validation evidence."
---

# Update PR metadata

Write a description a maintainer can assess from the current change. Edit title and body only.
Code changes, pushes, PR creation, and merging must come from the user's larger task;
preserve authorization already given.

## Workflow

1. Use the named PR or the current branch's PR. Resolve repository, base, and head SHA with
   live GitHub data. Use `gh` with explicit PR/repository arguments after discovery, structured
   JSON for inspection, and full pagination for lists; treat API failures as failed reads.
   If there is no PR, report that without creating one.
2. Read title/body, commits, files, and actual diff. Inspect current-head checks, relevant
   reviews/threads, and receipts. Separate local checks, hosted CI, manual testing, and
   historical measurements. Historical evidence needs its original SHA, environment, and
   limitation. Metadata editing does not require running tests or fixing code.
3. Load the template and contribution/title rules from the current base using a freshly
   fetched ref or GitHub. Read [template discovery](references/templates.md) for paths,
   multiple templates, or a missing template.
4. Rewrite around the problem and resulting behavior. Preserve template headings and
   checkbox lists; fill required sections and remove filled placeholders. Preserve valid
   measurement receipts with their original SHA and conditions; update measured values only
   from a new measurement. Correct or remove inaccurate or obsolete table rows using evidence,
   including nonmeasurement matrices and claims invalidated by source inspection. Cut stale
   prose claims and trivia. Include material migrations, flags, risks, docs, and follow-ups
   where needed. Keep the title short and consistent with scope, draft state, and repository
   rules. If the project uses Conventional
   Commits, preserve the `!` in a breaking `type(scope)!: description` subject and a
   `BREAKING CHANGE:` footer naming the old behavior and migration when a squash body is needed.
5. Mark validation honestly. Leave unperformed full-suite, native, and manual smoke checks
   unchecked. Explain N/A; preserve advisory failures and post-merge acceptance. A focused
   pass or older head cannot establish current full-suite readiness.
6. Verify related GitHub issue scope and state. Use `Fixes #N` only for full resolution and
   `Ref #N` for partial work, in the template's issue section or at the end. Remove incorrect
   refs. Before posting, inspect the exact title, body, and any suggested squash body for secrets,
   confidential tracker details, private local paths, and internal-only links. Follow the
   repository's disclosure policy and preserve public issue references; do not assume every
   project uses the same tracker or forbids external tracking links.
7. Write the exact body to a unique task file. Re-fetch before editing and reconcile head
   or owner edits. Apply `gh pr edit`, then re-fetch title, body, and head; compare saved text
   with the intended text and evidence. Read [command examples](references/editing.md) when
   needed. Command success alone does not prove the saved result.

For a draft-only request, return the proposed title and body without applying the edit.

## Handoff

Report the PR URL and a short list of metadata changes. Include a suggested squash/merge body
only when requested, required by a template field, or needed by the authorized delivery workflow.
When included, omit the subject, explain why, and retain relevant `Fixes`/`Ref` lines and breaking
change migrations. Leave signing and sign-off generation to merge tooling. Follow repository
policy for wrapping and PR numbers; otherwise use concise paragraphs and a readable line width.
Describe the final diff instead of concatenating child messages. Do not paste the old body.
