# Update issues

Maintain reports, requests, tracking, and lifecycle state from current evidence.

## Inspect and classify

Read the issue's full body, state and reason, author, labels, assignees, milestone,
relationships, project fields, and relevant conversation. Check linked PRs and source
before calling work fixed or shipped. Search open and closed issues for duplicates and
related reports; search results are discovery, not proof of absence.

Read current contribution rules and `.github/ISSUE_TEMPLATE/` Markdown templates or YAML
forms, including `config.yml`. Templates describe expected information; an existing issue
is edited as Markdown. Preserve supplied environment details, logs, reproduction steps,
attachments, and reporter attribution. Redact secrets according to repository policy.

## Improve the report

For bugs, capture the trigger, expected and actual behavior, affected versions and
environments, minimal reproduction, impact, and available evidence. Distinguish an
unverified report from a reproduced failure. Ask only for information needed to reproduce
or choose a fix, and record what is already known.

For requests, describe the user problem, intended outcome, scope, constraints, alternatives
when relevant, and observable acceptance criteria. For tracking issues, distinguish shipped,
open, blocked, and deferred work; link each concrete item. Preserve useful rationale and
keep status consistent with linked implementation evidence.

Write a searchable title naming the affected behavior. Retain the original report's meaning;
use an attributed clarification or authorized comment when rewriting would erase history.
Do not mark acceptance criteria complete because a PR exists or CI passed.

## Triage and lifecycle

- Apply existing labels and issue types using repository definitions. Separate priority
  from confidence; severity, reproducibility, and scheduling are different facts.
- Assign owners, milestones, or project status only when the task and repository policy
  support the change. Verify field IDs, allowed values, and membership before writing.
- Link parent/sub-issues and blocking relationships when useful and authorized. Check
  direction and full URLs across repositories. An issue number, REST ID, and GraphQL node
  ID are different identifiers. Avoid self-links, cycles, and accidental scope expansion.
- Confirm duplicates by behavior and scope, link the canonical report, and retain unique
  evidence. A similar title is insufficient. Closing requires an authorized lifecycle task.
- For closure, verify the repository's completion criteria and record the actual reason:
  completed, duplicate, or not planned as supported by the tool and host. A closed PR alone
  does not establish resolution. Reopen only when authorized and evidence warrants it.
- Treat inactivity as a triage lead. Follow the repository's stale policy and check for
  unanswered maintainer requests or ongoing work before proposing action.

## Save and verify

Re-read title, body, update time, and changed fields before applying the focused edit.
Preserve unrelated labels, assignments, and relationships; replacement arrays can remove
existing values. Read back exact text, state/reason, and every requested metadata field.
A failed field update may leave other fields changed; inspect before retrying.

Report the issue URL, applied changes, open questions, and implementation links. File
follow-ups only when the task authorizes creation; otherwise return concrete drafts.
