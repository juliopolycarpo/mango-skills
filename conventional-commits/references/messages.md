# Types, compatibility, and squash messages

Use repository policy before this default type list.

| Type       | Change represented                                             |
| ---------- | -------------------------------------------------------------- |
| `feat`     | New capability or public API, even when added for tests        |
| `fix`      | Corrected observable behavior                                  |
| `perf`     | Performance improvement supported by evidence                  |
| `refactor` | Restructuring that preserves supported behavior                |
| `test`     | Tests or test infrastructure without new production capability |
| `docs`     | Documentation                                                  |
| `build`    | Build tooling, dependencies, or toolchains                     |
| `ci`       | CI workflows and automation                                    |
| `style`    | Formatting without behavior changes                            |
| `chore`    | Maintenance with no more specific type                         |
| `revert`   | Reversal, with reason and original SHA in the body             |

This expanded type set and a required body are conventions rather than specification requirements. The
[Conventional Commits specification](https://www.conventionalcommits.org/en/v1.0.0/)
defines `feat`, `fix`, and breaking-change notation. Release selection still follows the
repository's policy, including its handling of breaking changes before 1.0.

A signature can stay identical while callers break. Check error variants, cancellation
outcomes, defaults, CLI output, and minimum supported toolchains. The breaking-change footer
must state the old behavior and the required migration.

## Squash and PR titles

When the PR title supplies the squash subject, make it a Conventional Commit subject
and carry the compatibility marker itself. A child commit's `!` or footer does not
survive automatically.

```text
fix(release)!: drop the legacy manifest format

Release tooling now rejects manifests without a schema version.

BREAKING CHANGE: manifests lacking `schema` are no longer read. Add
`schema: 2` to existing manifests before upgrading.
```

Use the `!` form in the PR title and the squash subject, and put the `BREAKING CHANGE:` footer
with its migration in the squash body. Add the relevant GitHub issue references.

For squash messages, describe the final diff instead of concatenating child messages. Follow
repository wrapping and length conventions, using concise paragraphs when none exist. Leave
required signatures and applicable sign-off generation to the authorized merge operation.
