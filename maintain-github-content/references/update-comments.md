# Update comments and review discussion

Identify the exact comment surface before reading or writing. Conversation comments on
issues and PRs share the issue-comment API. Inline review comments, submitted review bodies,
and review threads use different APIs and identifiers.

## Read the discussion

Resolve the URL, repository, parent issue or PR, comment ID, author, and update time.
Read preceding and subsequent context, including all relevant pages. For a review finding,
read the full thread and inspect the current head and reported lines before responding.
An outdated diff position does not establish that a finding is fixed.

A GraphQL thread ID identifies a thread, a numeric review-comment ID identifies an inline
comment, and a review ID identifies a submitted review. Never substitute one for another.
Verify the authenticated account and editing permissions. Edit another person's text only
when explicitly authorized and permitted; preserve attribution and the original meaning.

## Choose the maintenance action

- Edit an existing comment for a requested correction or maintained status summary. Preserve
  useful history; explain material corrections when removing a statement would mislead
  readers who already responded to it.
- Add a conversation update only when authorized. State the new fact, evidence link, and
  next action. Search existing comments for a matching update before posting or retrying.
- Reply inline to a code finding in its existing thread. State whether it is accepted,
  declined with a reason, or addressed through an alternative. Link the implementation
  and checks that support a fixed claim. Keep speculation separate from confirmed facts.
- Resolve a thread only when authorized and the current code addresses the actionable
  finding. Re-read the discussion and current head, then verify the resulting thread state.
  Declining a suggestion does not prove its finding is addressed.
- Delete, minimize, lock, or hide content only when the task explicitly covers moderation
  and repository policy permits it. Do not remove criticism or historical context as cleanup.

Posting comments and requesting reviews can notify people. A body-edit request does not
implicitly authorize those actions. Follow repository rules for bot reviews; do not add
manual review mentions unless the task and policy permit them.

## Save and verify

Follow the [common save and verification workflow](../SKILL.md#maintenance-workflow).
Use the exact comment ID, not a last-comment selector. Verify the saved body, author, and
parent; retain URLs and IDs for new comments. If editing that surface is unsupported, use
an authorized API fallback or return the draft. Do not substitute a new comment for an edit.
