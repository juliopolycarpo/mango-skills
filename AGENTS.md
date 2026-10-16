# Maintaining Mango Skills

Keep each skill usable when installed alone. Put its trigger and essential workflow in
`SKILL.md`, conditional detail in local references, and deterministic work in scripts. Do not
require sibling skills, personal hooks, fixed identities, private trackers, or a particular
machine layout. Follow the consuming repository's policies and preserve task authorization.

Use Bun for repository commands and dprint for formatting. Read `package.json` before changing
scripts. Keep JavaScript helpers limited to `node:` APIs and Python ports limited to the
Python 3.9+ standard library. Change both implementations together, preserving arguments,
output, and exit codes. Test public helper functions and prove behavioral fixes fail for the
intended reason before the fix and pass afterward.

Run `bun install --frozen-lockfile`, then `bun run check`. For stateful workflow changes,
exercise realistic cases in temporary repositories without remote mutations. Structural
validation alone does not prove a workflow. Keep Linux, Windows, browser, and hosted evidence
separate; report checks that were not run.

Preserve source attribution and bundled license notices. Keep contributions focused and
write Conventional Commit subjects with a body explaining the problem and result. Do not
publish, merge, rewrite remote history, or change user installations unless the task covers it.
