---
name: dependabot-rollup
description: Use for routine dependency or toolchain upgrades, combining Dependabot PRs, or checking release-age eligibility.
---

# Dependency rollup and toolchain updates

Choose the requested task and load only its guidance:

- Combine Dependabot PRs: follow the rollup below.
- Upgrade a named runtime, compiler, or build tool: use
  [toolchain upgrades](references/toolchain-upgrades.md), without unrelated bot PRs.
- Check eligible versions: use the [release-age sweep](references/release-age.md).
  Reporting candidates does not authorize applying them.
- Adapt changed SDK or library behavior: follow the local
  [contract adaptation guide](references/adaptation.md).

## Build the rollup

1. Inspect the worktree and local changes. Fetch the current target base, record its SHA, and
   use a dedicated or suitable prepared worktree with missing repository setup completed.
2. Inventory all relevant open Dependabot PRs through `gh`. Paginate past list caps, and filter
   on `.user.login == "dependabot[bot]"` from `gh api --paginate 'repos/<slug>/pulls?state=open'`;
   `gh pr list --author dependabot` misses the App's PRs. Record
   each head, base, version change, and CI state; classify it as included, obsolete, or targeting
   another base. Verify obsolescence and explain discrepancies in the expected count.
3. Record selected heads and create the branch from the verified base. Cherry-pick with
   provenance, repository-required signatures and sign-offs, and original authorship. Integrate independent updates
   before overlapping dependency groups; track uniquely named temporary refs.
4. Reconcile versions against compatibility, holds, major boundaries, and release-age policy.
   Regenerate lockfiles with repository tooling. For Bun, retain a valid starting lockfile and
   run `bun install`; do not hand-merge generated records. Check framework deduplication where
   duplicate packages affect type identity.
5. Check scripts, composite actions, tests, provisioning, and docs for missed pins. Resolve
   annotated action tags to commit SHAs where the repository requires SHA pins.

## Validate and finish

Run required checks and affected lanes omitted by root scripts, such as Cargo or protocol
interop. Inspect exit statuses and final summaries. Reuse validation only for unchanged
content and environment; rerun affected checks after changes.

Preserve contributor attribution and policy-required sign-offs. For message-only repairs, exclude
staged content and verify the tree is unchanged. Follow the local [commit and readiness guide](references/publication.md) for
identity, signature and trailer verification.

When PR publication is in scope, push and follow the current base template. Record included and
superseded PRs, versions, holds, compatibility decisions, and validation gaps. Finish requested
CI and review follow-up using the local [readiness guide](references/publication.md#bring-the-current-head-to-readiness).

Reference rolled-up PRs as `Supersedes #N` and related unresolved issues as `Ref #N`, never
`Closes #N`; after merge close only the PRs the rollup body names and keep its stated exceptions
open. After an authorized merge, verify superseded PR states. Closing keywords do not close another
PR; close obsolete bot PRs manually only within authorization. Clean up only task-created refs,
branches, and worktrees after checking for unpushed work. Never delete shared ref namespaces.
