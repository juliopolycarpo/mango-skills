# Merge messages and signing

Follow the repository's message policy and recent merges. When Conventional Commits are
used, write an appropriate subject such as `chore: merge release history (#42)` and a body
explaining the delivered history and integration decisions. Wrap prose according to local
style and retain relevant public issue references.

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

## Public text check

Before committing or merging, inspect the exact message for secrets, private tracker links,
internal plan names and local filesystem paths. Follow the repository's policy for public
issue references; do not assume a particular tracker is private or public. Retain legitimate
references that belong in the repository's history.

Keep repository hooks and required signing enabled. Fix failures instead of bypassing them.
