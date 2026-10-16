---
name: unslop
description: "Use to edit prose for direct, specific writing while preserving facts, voice, and required formats."
---

# Unslop

Make writing direct, specific, and checkable. Apply while drafting and before sending; return
only the final text unless asked for an editing report.

A tell is a symptom. Fix the defect behind it (no claim, hidden actor, unsupported weight,
missing evidence), not the surface word; swapping words to look human is not the goal.

## Rules

- Lead with the fact, decision, or result. Keep the context the reader needs to act; cut
  repetition that adds no information.
- Name the actor, mechanism, and observable effect. Prefer a number, command, version, or exact
  error over an adjective. Keep real uncertainty, stated once and specifically.
- State points directly. Cut staging: "not X but Y" contrasts nobody raised, one-line closers,
  run-ups ("Here's the thing"), defenses against objections nobody made, and significance
  claims ("pivotal", "this ensures"). See the [pattern catalog](references/patterns.md).
- Use plain words and `is`/`has`. Repeat the exact name of a symbol, flag, or concept; never
  cycle synonyms. Long, dense sentences are fine when they read in one pass; split one only when
  a reader would stop to parse it.
- Punctuation: do not add em dashes for rhythm, and do not mechanically turn every dash into a
  comma or period either. Use a colon to introduce a consequence, example, or list ("reads are
  bounded at 5 s: a peer that never answers fails the call"). Straight quotes in your own text.
- Formatting follows the surface: plain text in commit messages, the repository template in PRs
  and issues, sentence-case headings, bold only for a term the reader must not miss, tables
  when comparisons or results are easier to scan. No decorative emojis or arrows.
- Follow the reader's language and the destination's contribution rules. Before publishing,
  remove credentials, private tracking references, local paths, and internal-only material.
  Preserve public issue references and information the author intentionally made public.

Preserve facts, numbers, SHAs, commands, commitments, attribution, code, quotations, and required
formats. Leave quoted or discussed phrases alone.

## Check before sending

1. Compare against the source: no fact, number, name, or claim added; none dropped unless it was
   filler; uncertainty kept where it was real.
2. Search again for the tells that survive rewrites: contrasts, closers, triads, dashes, bold
   labels, and a reply that rebuilds context before its decision.
3. Search for leftovers: chat wrappers ("I hope this helps", "Let me know"), placeholders
   (`[Insert …]`, `TODO: fill`, `2026-xx-xx`), and tool markup (`oaicite`, `[cite: N]`,
   `utm_source=chatgpt.com`).

## Modules

Load only the module for the text being written. Preserve the destination's required template
and format while editing its wording.

- [Pattern catalog](references/patterns.md): contextual examples for an editing pass or self-audit.
- [Commits](references/commits.md): subjects, bodies, squash bodies.
- [Pull requests](references/pull-requests.md): titles, bodies, validation.
- [Review replies](references/reviews.md): findings, thread replies, review summary comments.
- [Issues](references/issues.md): bug reports, feature requests, issue comments.
- [Docs](references/docs.md): READMEs, guides, API docs, release notes.
- [Agent docs](references/agent-docs.md): memory, CLAUDE.md, AGENTS.md, skills, agent definitions.
