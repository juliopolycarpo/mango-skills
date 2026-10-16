# Contributing

Report a skill failure with the skill name, agent and tool versions, the task you tried,
expected behavior, actual behavior, and a minimal reproduction. Remove credentials and
private repository content. Suggest a skill or improvement with a concrete workflow and
an example of the result it should produce.

## Make a change

1. Keep the change within one concern. Read the affected skill, its references, and helpers.
2. Preserve standalone installation. Bundle required resources in that skill's directory;
   follow the consuming project's tools and policies rather than personal setup assumptions.
3. Put conditional detail in references. Add a helper only when deterministic execution adds
   value. Keep JavaScript and Python implementations compatible and test both.
4. For behavior fixes, show the intended failure before the fix and a pass afterward. Exercise
   Git and release workflows in isolated fixtures; do not mutate live services as a test.
5. Run the checks below. In your PR, explain the problem, resulting behavior, validation,
   and anything unverified. Include source and license notices for adapted work.

## Checks

Use Bun 1.4.3, Python 3.9 or newer, and Git with `merge-tree --write-tree` support.

```bash
bun install --frozen-lockfile
bun run check
```

Individual commands are `bun run validate`, `bun test`, `bun run test:python`,
`bun run smoke`, and `bun run format:check`. Format with `bun run format`.
The helper smoke uses synthetic Git history and named fakes, with no registry or GitHub
requests. CI configures Linux and Windows checks.

Keep repeated readiness documents and shared GitHub query sections identical. The repository's
`scripts/shared-guidance.test.mjs` checks these copies; update each copy together. The complete
copies stay inside their skill directories so installed skills need no sibling resources.

Use Conventional Commit subjects such as `fix(rebase-pr): preserve the recorded remote head`
and a body describing why the change is needed. Follow any additional contribution policy
adopted by the repository. Keep source attribution with each independently copied skill.
