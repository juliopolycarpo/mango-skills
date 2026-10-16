---
name: maintain-github-content
description: "Use to maintain GitHub PRs, issues, comments, triage metadata, and repository content through evidence-based audits and verified updates."
---

# Maintain GitHub content

Keep GitHub content accurate, useful, and consistent with the repository's current state.
Use this guide for one requested edit or an ongoing maintenance sweep: PR descriptions,
issue reports, review replies, labels, ownership, milestones, project tracking, and stale
or duplicate content. Follow the consuming repository's policies and the user's existing
authorization. The skill is self-contained; either GitHub CLI or GitHub MCP can provide I/O.

## Choose the workflow

| Task                                                                         | Read                                                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Refresh PR title, description, evidence, or triage metadata                  | [Update PRs](references/update-pr.md)                      |
| Improve reports, acceptance criteria, relationships, or issue lifecycle      | [Update issues](references/update-issue.md)                |
| Edit comments, post authorized updates, or handle review discussion          | [Update comments](references/update-comments.md)           |
| Apply templates, writing rules, evidence standards, or a maintenance cadence | [Conventions](references/conventions.md)                   |
| Inspect or update content with `gh`, REST, or GraphQL                        | [GitHub CLI reference](references/gh-reference.md)         |
| Inspect or update content with GitHub MCP tools                              | [GitHub MCP reference](references/github-mcp-reference.md) |

## Maintenance workflow

1. Establish the target and outcome. Resolve the host, repository, object type, number or
   comment ID, and requested fields. Use explicit URLs or live discovery; issue and PR
   numbers share a namespace. Identify whether the task is an audit, draft, edit, creation,
   triage sweep, or lifecycle change. Draft-only work ends with proposed content.
2. Read repository policies, contribution rules, and applicable templates from the live
   target branch. For PRs use the base branch; for issues use the default branch. Inspect
   existing labels, milestones, issue types, and project fields before proposing changes.
   Preserve task authorization; ask only for a missing decision that blocks the work.
3. Inventory current content and context. Read the body, metadata, relevant conversation,
   linked issues or PRs, and source or CI evidence. Paginate every relevant collection,
   including nested review comments. Record the inspected PR head and the object's update
   time. A failed or truncated read leaves the audit incomplete.
4. Prepare a focused maintenance plan. For a sweep, group work by repository and object,
   identify obsolete claims, missing context, duplicate reports, ownership gaps, and stale
   tracking. Rank by impact and evidence. Age alone does not justify closure or deletion.
   Separate confirmed defects, reproduced failures, hypotheses, and completed work.
5. Draft the smallest complete update. Preserve useful history, source attribution,
   measurements, required template fields, and human edits. State the problem, current
   behavior, evidence, and next action. Use the task-specific reference for details.
   Scan the exact outgoing text for confidential data and repository policy violations.
6. Apply authorized changes. A request to edit a body covers that body; it does not add
   comments, notify reviewers, change lifecycle state, or modify repository settings.
   Create content or post replies only when the task covers it. Keep code, commits,
   releases, Actions configuration, access controls, and branch protection changes within
   their separately authorized implementation tasks. Report discovered maintenance needs
   with concrete evidence and a proposed next action.
7. Re-read immediately before each write. Reconcile changed text, metadata, or PR heads;
   avoid overwriting concurrent edits. Save the exact proposed title/body or structured
   payload to a unique task file. Use the narrowest write operation and preserve fields
   outside the request. On timeout, inspect the object before retrying to avoid duplicates.
8. Read back from GitHub and compare saved content and requested metadata with the draft.
   For PRs confirm the head still matches the evidence. Inspect partial failures field by
   field; command success alone is insufficient. Repeat an audit only when changed state
   invalidates its conclusions.

## Handoff

Link each changed object and state what changed, what was verified, and what remains open.
For a sweep, give inspected scope, pagination limits, skipped objects, and follow-ups with
owners when known. Distinguish completed edits from drafts and blocked writes. Report local,
hosted, native, browser, and manual evidence separately. Do not claim checks you did not run.
