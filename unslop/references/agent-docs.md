# Agent docs

Memory files, CLAUDE.md, AGENTS.md, skills, and agent definitions are read by a model at the
start of work, often every session. Each line costs context and attention, so write for recall
and action.

- One fact or rule per line, organized by topic. Imperative for rules ("Run X before Y"),
  declarative for facts ("The validator rejects links outside the skill directory").
- Give the reason when the rule would otherwise look arbitrary or get broken: one short clause
  or a **Why:** line, not a story.
- Keep only what the reader cannot get elsewhere. Drop facts the harness, repository, git
  history, or the destination already provides. Keep essential workflow steps and bundled
  references available within a standalone skill; do not require another skill to execute it.
- Dates are absolute ("2026-10-15"), not "yesterday". Mark a status that will go stale and say
  where to read the current value (`git tag`, the PR) instead of pinning it.
- Skill and agent descriptions: one or two sentences that start with when to use it and name
  the phrases or situations that should trigger it, then what it produces. No marketing, no
  feature list.
- No generic engineering advice ("write clean code", "be careful"). If a line would fit any
  project unchanged, cut it.
- Follow the target's ownership rules. In editable docs, replace wrong lines and remove obsolete
  rules. For generated memory or append-only notes, use the authorized correction mechanism
  instead of editing the existing file.
