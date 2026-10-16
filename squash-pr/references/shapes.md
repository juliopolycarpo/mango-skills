# Discover the repository's message shape

Read contribution instructions, commitlint or release configuration and recent target-base
commits before drafting:

Use the fetched ref from the verified PR base repository, which may differ from `origin`.

```bash
git log -5 --format='%h %s%n%b%n---' <fetched-base-ref>
```

Use the established subject style, paragraph layout, issue reference syntax and trailer
policy. A separator before trailers is optional and belongs only where the repository uses
one. If there is no established style, write a short subject and a body explaining the final
behavior and reason. For Conventional Commits, preserve compatibility markers and migration
footers.

```text
fix(runtime): await connection teardown during shutdown (#42)

Wait for pending connections to close so shutdown does not leave
background work running.

Fixes #39
```

For a breaking change:

```text
fix(config)!: require a schema version (#43)

Reject ambiguous legacy configuration instead of guessing its format.

BREAKING CHANGE: configuration now requires a schema version. Add
schema: 2 before upgrading.
```

These examples omit trailers. Add them only under the repository's applicable certification
and attribution policy, using verified identities. Preserve legitimate contributor trailers;
do not infer co-authorship from a tool, account name or bot being present.
