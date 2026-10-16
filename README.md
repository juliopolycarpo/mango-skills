# Mango Skills

Standalone agent skills for reviewing, testing, upgrading, and shipping software. Each skill
includes its own workflow and references, so you can install only the ones you use.

## Use a skill

Copy a complete skill directory into your agent's configured skills directory, including its
`references`, `scripts`, `agents`, license notices, and `assets` when present. The destination
path and invocation syntax depend on your agent. You can also point an agent at a skill's
`SKILL.md` directly and ask it to follow that workflow.

For example, give the agent [prove-regression/SKILL.md](prove-regression/SKILL.md) with this task:

> Fix the reported cancellation bug. Show that the regression test fails for the intended
> assertion before the fix, then passes afterward.

The skills follow the consuming repository's instructions, tools, and contribution policies.
Invoking a skill does not grant permission to publish, merge, delete data, or rewrite remote
history. GitHub workflows need an authenticated `gh` installation with the permissions the
requested task requires. Check installed tool versions before using version-dependent flags.

## Skills

| Skill                                                 | Use it for                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| [babysit](babysit/SKILL.md)                           | Follow CI and review feedback through PR readiness                 |
| [conventional-commits](conventional-commits/SKILL.md) | Draft commit messages, PR titles, and squash bodies                |
| [deliver-pr-wave](deliver-pr-wave/SKILL.md)           | Coordinate one PR or a dependent wave through authorized delivery  |
| [dependabot-rollup](dependabot-rollup/SKILL.md)       | Combine dependency updates and check release-age eligibility       |
| [merge-pr](merge-pr/SKILL.md)                         | Land history with a signed merge commit while preserving its SHAs  |
| [prove-regression](prove-regression/SKILL.md)         | Prove a test catches the defect before verifying the fix           |
| [qualify-performance](qualify-performance/SKILL.md)   | Compare performance with controlled trials and retained evidence   |
| [rebase-pr](rebase-pr/SKILL.md)                       | Replay a branch and review interactions with its new base          |
| [squash-pr](squash-pr/SKILL.md)                       | Land one curated commit and verify the resulting integration tree  |
| [unslop](unslop/SKILL.md)                             | Edit prose for direct, specific writing while preserving its facts |
| [update-pr-body](update-pr-body/SKILL.md)             | Refresh PR metadata from the current diff, template, and evidence  |

Helpers have matching JavaScript and Python implementations. JavaScript helpers use only
`node:` APIs and run under Node or Bun; Python helpers use the Python 3.9+ standard library.
Repository validation uses Bun. Some helper checks require Git with `merge-tree --write-tree`.

## Contribute

Bug reports, portable workflow improvements, and regression cases are welcome. Include the
skill, tool versions, expected result, and a minimal reproduction. See
[CONTRIBUTING.md](CONTRIBUTING.md) for development checks and contribution scope.

```bash
bun install --frozen-lockfile
bun run check
```

CI is configured for Linux and Windows.

## License and sources

Original work is licensed under [MIT](LICENSE).
[Unslop](unslop/NOTICE.md) retains attribution and the upstream MIT notice for Humanizer.
Keep bundled notices when copying a skill. This project is independently maintained.
