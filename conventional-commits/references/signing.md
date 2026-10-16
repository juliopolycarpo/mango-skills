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

## Local commits and replays

Use `git commit -F <file>` with `-S` when signing is required and `--signoff` when policy
requires it and the configured committer can make the certification. A sign-off is an
attestation, not a cryptographic signature; enabling signing does not generate one. If a
commit wrapper supplies trailers, inspect its behavior to avoid duplicates. Keep hooks enabled.

Inspect commits after creation, rebase, cherry-pick, or message replacement:

```bash
git log --format='%h|%G?|%cn <%ce>|%(trailers:key=Signed-off-by,valueonly,separator=;)' <base>..HEAD
git show --format=fuller --stat HEAD
```

Verify signatures and trailers required by repository policy. A signature header alone does
not prove verification; distinguish an invalid signature from missing verifier trust.
Preserve legitimate contributor trailers and repair only within the authorized history range.
For message-only changes, compare old and new tree IDs and exclude staged content. Revalidate
the final range after the last replay, then use an exact lease for an authorized force-push.

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
