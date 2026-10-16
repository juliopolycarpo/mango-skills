# Squash messages and signing

## Squash messages

Read repository instructions, hooks or commitlint rules, release policy and recent base
commits. When the repository uses Conventional Commits, write `type(scope): description`,
with an optional scope and an imperative subject naming the final behavior. Common types
are `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `style`, `chore` and
`revert`; repository policy wins.

For Conventional Commits, the squash subject must carry `!` for a compatibility break.
Check supported contracts including errors, cancellation, defaults, CLI output and minimum
toolchains. A child commit's `!` or footer does not survive automatically. Include
`BREAKING CHANGE:` in the squash body with the old behavior and required migration.

Describe the final diff instead of concatenating child messages. Follow repository length
and wrapping conventions; use concise paragraphs when no convention exists. Include
`Fixes #N` for a fully addressed GitHub issue and the repository's reference syntax for
partial work. Verify issue scope and state. See [message shapes](shapes.md).

## Signing and identity

Inspect the repository's contribution policy and effective configuration:

```bash
git config user.name
git config user.email
git config --get commit.gpgsign
git config --get gpg.format
git config --get user.signingkey
```

Use the configured identity, not an account login. Do not expose private signing material
or override identity to satisfy a hook. Preserve legitimate contributor attribution without
inventing sign-offs or co-authorship.

For local commits, `git commit -S -F <file>` requests a cryptographic signature using the
configured signing method. Add `--signoff` only when repository policy requires it and the
configured committer can make the project's certification. A sign-off is an attestation,
not a cryptographic signature. Git does not generate one merely because signing is enabled.
If the environment provides a commit wrapper, inspect its behavior before combining it with
explicit flags so trailers are not duplicated.

Inspect the resulting commit, including signatures when required and trailers against the
repository's policy. A signature header alone does not prove verification; distinguish an
invalid signature from a verifier lacking trust information. Repair only within the task's
authorized history range. For message-only changes, compare tree IDs and ensure no staged
content entered the replacement.

## Hosted squash

GitHub's hosted merge does not run local commit commands or hooks. Inspect repository policy
for required signatures, DCO certification and attribution before choosing hosted squash.
If hosted merging cannot meet those requirements, report the gap before merging.

For an authorized squash that requires the configured committer's sign-off, first verify
that the committer can make the project's certification. Generate the trailer from effective
Git configuration into a separate final body file. For example, after confirming the draft
does not already contain this sign-off:

```bash
committer_name=$(git config user.name) || exit 1
committer_email=$(git config user.email) || exit 1
[[ -n "$committer_name" && -n "$committer_email" ]] || exit 1
git interpret-trailers --trailer "Signed-off-by: $committer_name <$committer_email>" \
  < "$draft_file" > "$final_file"
```

Use distinct branch-prefixed draft and final paths. Validate required trailers without
duplicating the committer's sign-off, and preserve legitimate contributor trailers. Do not
add a sign-off when policy and the task do not call for one. A drafting-only task leaves
certification to the authorized merge operation.

Use `gh pr merge --body-file` and `--match-head-commit` for the reviewed SHA. Re-fetch the
actual integration commit and verify its message, tree and any required signature. A failed
verification requires investigation; [message repair](repair.md) requires authorization and
repository permission, and applies only to an unchanged default-branch tip.

## Public text check

Before committing or merging, inspect the exact message for secrets, private tracker links,
internal plan names and local filesystem paths. Follow the repository's policy for public
issue references; do not assume a particular tracker is private or public. Retain legitimate
references that belong in the repository's history.

Keep repository hooks and required signing enabled. Fix failures instead of bypassing them.
