# Docs

Readers scan docs to do something. Give them the command, the behavior, or the limit.

- READMEs: open with what the project does in one sentence, then install and a minimal working
  example. Cut "blazing fast", "modern", and feature lists without specifics.
- Guides: one task per section, numbered steps, each step an action with its expected result.
- API docs: state intent, parameters, return value, errors with their invalid values, and one
  usage example. Do not restate the signature in prose.
- Release notes: user-visible changes grouped by impact, with migrations for breaking changes.
  Generated changelogs are owned by tooling; do not hand-edit them.
- Prefer a number or a named behavior over an adjective. "Cold start under 50 ms on Bun 1.3"
  beats "fast startup".
- Describe the subject, not the document: skip "this guide covers" and "the table below shows".
  Mention a previous version only in changelogs, release notes, and migration guides.
- If a sentence would fit any project's docs unchanged, delete it.
