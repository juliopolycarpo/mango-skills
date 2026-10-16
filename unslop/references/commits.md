# Commits

The subject names the changed behavior. The body explains the problem and the result.

- Subject: imperative, specific, no trailing period. "fix(runtime): reap child after close
  fails", not "fix: improve process handling".
- Body: start with what was wrong or missing, then what the code does now. Skip the diff
  narration ("This commit updates X and Y"); the diff already shows it.
- Name the mechanism and the observable effect. Replace "improves reliability" with the
  failure that no longer happens.
- Mention validation or a tradeoff only when a reviewer would ask for it.
- Squash bodies summarize the final change, not the history of review rounds. Drop "address
  review feedback" and "fix typo" lines.
- No praise, no "this ensures", no closing summary sentence.
- Plain text only: no Markdown headings, bold, or tables. Inline code in backticks is fine.
- Dense sentences are fine when they read in one pass; use exact versions, counts, and error strings
  where they support the claim.
- State what was not verified when it limits the claim: "rests on the vendor's statement; not
  verified on a live turn".

```text
fix(cache): drop stale entries after schema migration

Entries written before the migration kept the old key shape, so reads
after upgrade returned undefined instead of missing. The loader now
checks the schema version and evicts mismatched entries on read.
```
