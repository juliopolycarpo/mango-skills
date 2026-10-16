---
name: squash-pr
description: Use to land a feature PR as one curated squash commit, or repair its squash message when that repair is requested or authorized.
---

# Squash a PR

Land one PR as a single commit following the consuming repository's policy, and prove the
result on the base. The request that names the merge authorizes it; do not ask again, and
do not merge past a failed gate. Qualify checks, reviews, threads and merge state using
[readiness](references/readiness.md), including serialization when strict base rules apply.

Use squash only when the repository and task permit that landing method. An umbrella branch or imported
history whose commits must keep their SHAs and signatures requires a true, signed merge
commit preserving that history. Stop this workflow for that case. Rebase merging also rewrites commit identities and
cannot preserve their original signatures.

## Squash workflow

1. Resolve the live PR: base repository and branch, head repository, number, title,
   `headRefOid`, and state. Match the base repository URL to a remote's fetch and push URLs;
   record `<base-remote>`, `<base-branch>`, and its `<fetched-base-ref>`. Fetch the verified
   base branch and reviewed head objects, including forks. Never assume `origin` is the base.
   Record the head SHA
   you reviewed; it is the only SHA you may merge. Complete the
   [readiness gates](references/readiness.md) for that SHA before landing and refresh them
   immediately before the merge.
2. Read the base's last merges to copy the repository's layout:
   `git log -5 --format='%h %s%n%b%n---' <fetched-base-ref>`. See
   [message shapes](references/shapes.md).
3. Draft the message in a unique file (`<branch>-squash.txt`):
   - Subject: the PR title in the repository's style, including its PR-number convention. For Conventional Commits, carry any `!` from child commits; it does not survive automatically.
   - Body: the final behavior and why, from the final diff, not the commit list. Follow
     repository wrapping conventions and the guidance in
     [squash messages](references/messages.md#squash-messages).
   - A `BREAKING CHANGE:` footer with migration when the subject has `!`; issue refs as the
     repository writes them (`Ref #N`, `Fixes #N`).
   - Trailers: preserve legitimate contributor attribution. Generate any required committer
     sign-off from effective Git configuration only when that committer can make the
     certification; see [hosted squash](references/messages.md#hosted-squash).
   - Inspect the final text for private information using the
     [public text check](references/messages.md#public-text-check).
4. Merge:
   `gh pr merge <n> --repo <slug> --squash --subject "<subject>" --body-file <file> --match-head-commit <sha>`.
   Ensure the hosted merge can satisfy required signature, certification and attribution
   policy before executing it; a local hook does not run on GitHub.
5. Verify using the PR's actual `mergeCommit.oid`, fetched after GitHub reports it merged.
   Fetch the base and the reviewed head objects; the base may already contain later landings.
   Run `bun <skill-dir>/scripts/javascript/verify-squash.mjs <repo> <reviewed-head-sha> <actual-merge-sha> <fetched-base-ref>`
   (`node` also works, or `python3 <skill-dir>/scripts/python/verify_squash.py` with the same arguments).
   The helper verifies a single-parent squash on the fetched base and compares its tree to
   `git merge-tree --write-tree <actual-first-parent> <reviewed-head-sha>`. This retains
   independent base changes. It needs Git with `merge-tree --write-tree`; a conflict or
   unavailable object is an unverified result, never a pass.
6. Inspect that actual commit with `git show -s --format='%s%n%b' <actual-merge-sha>`: intended
   subject/body, policy-required trailers, legitimate contributor attribution and any required
   signature. Do not compare the latest base tip or the raw PR-head tree: either can differ after valid landing.
7. If message verification fails, use [repair](#repair-a-broken-squash) only when authorized
   and still safe. If content differs, investigate and report it; a message repair cannot fix
   an unexpected tree. Never rewrite the base merely to make verification pass.

## Repair a broken squash

A message-only repair requires task authorization and repository permission to rewrite the
default-branch tip. Verification alone does not authorize it. Follow
[repair](references/repair.md) only while the broken squash remains the tip. If policy forbids
rewriting, report the mismatch and leave the history intact.

## Completion

Report the merge commit SHA, method, verified subject, required trailer and contributor attribution checks, and expected integration-tree match. For a
repair, report the old and new tips, the empty `git diff --stat`, the lease used, and which
open branches must replay with `git rebase --onto <fetched-base-ref> <old>`. Then delete
task-created branches and worktrees when in scope, and update the relevant tracking record when in scope.
