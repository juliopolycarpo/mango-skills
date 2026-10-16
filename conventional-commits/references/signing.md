# Signing, trailers and squash messages

Read this for authorized commit creation, replay or squash merging. Signing and sign-offs
follow the consuming repository's policy; neither is implied by a request to draft a message.

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

## Local commits and replays

Use `git commit -F <file>` with `-S` when signing is required and `--signoff` only for an
applicable certification. Keep hooks enabled. Inspect the result of a rebase, cherry-pick
or message replacement even when the command succeeds:

```bash
git log --format='%h|%G?|%cn <%ce>|%(trailers:key=Signed-off-by,valueonly,separator=;)' <base>..HEAD
git show --format=fuller --stat HEAD
```

Preserve legitimate contributor trailers. Do not rewrite unrelated upstream history. For
message-only changes compare old and new tree IDs. Revalidate the final authorized range
after the last replay, then use an exact lease for any authorized force-push.

## Hosted squash

Hosted merging does not execute local commit commands or hooks. Prepare a body from the
final diff, preserving breaking-change migration and relevant public issue references.
When policy requires a sign-off and the configured committer can make that certification,
use Git's trailer machinery or a repository helper to generate it from effective
`git config user.name` and `git config user.email`. Avoid duplicates and preserve legitimate
contributor trailers. Do not synthesize contributor identity or attribution.

Use `gh pr merge --body-file` with `--match-head-commit` for the reviewed SHA when supported.
Verify the actual merged commit's message, tree and signatures required by policy. Report
mismatches. A repair requires explicit authorization and repository permission: confirm the
broken squash is still the default-branch tip, amend only its message in a clean worktree,
prove identical tree IDs and required signature/trailer properties, then use an exact lease.
If a later commit has landed, stop; do not rewrite a larger range. Record old and replacement
SHAs so dependent branches can replay. Verification alone never authorizes rewriting.
