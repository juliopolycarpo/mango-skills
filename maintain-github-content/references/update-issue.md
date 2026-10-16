# Update issues

Maintain reports, requests, tracking, and lifecycle state from current evidence.

## Inspect and classify

For a focused edit, read the issue and context needed to verify the changed claim. For a full
refresh or triage pass, inspect state/reason, metadata, relationships, project fields, and
relevant conversation. Check linked PRs and source before calling work fixed or shipped.
Search open and closed issues when assessing duplicates; search results cannot prove absence.

Read current contribution rules and `.github/ISSUE_TEMPLATE/` Markdown templates or YAML
forms, including `config.yml`. Templates describe expected information; an existing issue
is edited as Markdown. Preserve supplied environment details, logs, reproduction steps,
attachments, and reporter attribution. Redact secrets according to repository policy.

## Improve the report

For bugs, capture the trigger, expected and actual behavior, affected versions and
environments, minimal reproduction, impact, and available evidence. Distinguish an
unverified report from a reproduced failure. Ask only for information needed to reproduce
or choose a fix, and record what is already known.

For requests, state the problem, scope, and observable acceptance criteria. For tracking
issues, link shipped, open, blocked, and deferred work to implementation evidence.

Use a searchable title and preserve the reporter's meaning. Use an attributed clarification
when rewriting would erase history. A PR or passing CI alone does not satisfy acceptance criteria.

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

Follow the [common save and verification workflow](../SKILL.md#maintenance-workflow).
Preserve unrelated metadata; replacement arrays can remove existing values. Verify state,
reason, and relationships when changed. Report implementation links and open questions;
create follow-ups only when authorized.
