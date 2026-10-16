---
name: conventional-commits
description: "Use to draft or revise Conventional Commit messages, PR titles, and squash bodies, or split commits by concern."
---

# Conventional commits

Describe one coherent change and why it matters. A message request means drafting. Creating
commits, rewriting history, pushing, and merging follow the user's task and authorization.

## Workflow

1. Read repository instructions, hooks or commitlint rules, `cliff.toml`, and recent target
   commits. Inspect status and staged and unstaged diffs. Use exactly the intended files;
   split unrelated concerns and preserve other people's work.
2. Write `type(scope): description`, with optional scope and an imperative subject naming
   the changed behavior. Follow repository types, scopes, and length rules. Common choices
   are `feat` for capability, `fix` for observable corrections, `perf` for an evidenced
   improvement, and `refactor` for behavior-preserving restructuring. Read
   [type and compatibility guidance](references/messages.md) for other types, release
   implications, or uncertain breaking changes.
3. Include a body explaining the problem and result. Add validation or a tradeoff when
   useful. Separate subject, body, and footers with blank lines; wrap prose at 72 columns
   unless the repository says otherwise.
4. Check supported contracts, including defaults, errors, cancellation, CLI output, and
   minimum toolchains. For a break, include `!` before the colon and a `BREAKING CHANGE:`
   footer naming the old behavior and migration. The same `!` belongs in the PR title, which
   becomes the squash subject; see [PR titles and squash messages](references/messages.md#squash-and-pr-titles).
5. Use `Fixes #N` for a fully addressed GitHub issue and `Ref #N` for partial work. Verify
   issue scope, state, and cross-repository references.
   Inspect public text for secrets, private tracker links, internal plan names and local
   paths. Follow the repository's policy for issue references instead of assuming a
   particular tracker is private or public.
6. For authorized commit creation or replay, read [signing](references/signing.md). Write
   the exact message to a unique file and use `git commit -F`, adding `-S` or `--signoff`
   only as required by signing and certification policy. Keep hooks enabled. Verify changed
   files, the saved message and any required signature or trailers. A
   message-only rewrite must preserve the tree.

Read identity from Git configuration. Preserve legitimate contributor attribution; never
invent `Signed-off-by:` or `Co-authored-by:` trailers. A sign-off certifies contribution
under the project's policy; add it only when applicable, using Git's tooling and verified
identity. Fix actual hook or signing failures within scope.

```text
fix(runtime): reap a child after its close fails

Retain process control when close cannot confirm exit, so the runtime
can kill and reap the child before releasing the session.

Ref #123
```

A drafting task ends with the requested message. A commit task reports the resulting SHA,
validation actually run, and remaining uncommitted or unpushed work. Preparing a squash body
does not authorize merging.
