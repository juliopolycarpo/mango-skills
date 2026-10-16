# Stacks, replay comparison, and publishing

## Identify the feature boundary

For a simple branch, replay its intended commits onto the fetched base. For a stack,
establish the exact old parent boundary and which parent changes landed. A squash merge
need not preserve commit SHAs.

Let Git skip verified duplicate patches. Use `--onto` only when the old boundary and feature
commits are known. A similar commit subject does not prove a patch already landed. Compare
the original feature range with the new feature range, excluding already landed parent work.

```bash
git range-diff "$old_feature_base..$old_head" "$new_base..HEAD"
```

### Child of a squash-merged parent

1. Read the parent's final head with `gh pr view "$parent_pr" --json headRefOid`. It still
   works after the parent branch is deleted.
2. `git diff --stat "$parent_head" "$base_ref"` shows what else landed; an empty result means
   the squash is the parent's tree and the replay should be clean.
3. `git rebase --onto "$base_ref" "$parent_head"` replays only the child's commits.
4. Resolve `new_base_branch` from the target repository and task; do not assume `main`.
   Retarget the PR to the new base (`gh pr edit "$pr_number" --repo "$repo_slug" --base "$new_base_branch"`, or
   `gh api -X PATCH repos/$repo_slug/pulls/$pr_number -f base="$new_base_branch"`), then push to the PR's
   real head ref. A local worktree branch name is not the head ref. CI and rulesets often
   target only PRs based on the default branch, so re-check the checks after retargeting.

Read each changed or dropped patch and the full diff against the new base. Conflict-free
replays can still break new upstream contracts.

## Push with an exact lease

Only push when it is part of the requested outcome. Use the verified head remote and branch,
including forks, and the remote SHA recorded before rewriting.

```bash
git push \
  "--force-with-lease=refs/heads/$head_branch:$observed_remote_head" \
  "$head_remote" "HEAD:refs/heads/$head_branch"
```

Name recovery refs `refs/recovery/pr-<number>-before-rebase-<date>`. When several branches
are rewritten together, push them in one `git push --atomic` with one
`--force-with-lease=refs/heads/<branch>:<observed-old-sha>` per branch. For a signature-only
rewrite, `git range-diff` must show only signature metadata and trailers changed. If the PR has
already merged, audit its final tree and evidence instead of rebasing or pushing.

If the lease fails, preserve the local result and inspect the new remote work. Reconcile it
before any further push. Never turn the lease into an unconditional overwrite. Re-fetch the
PR after success and compare its head SHA with the pushed result.

## Scope examples

- "Rebase this local branch and review upstream interaction." Replay, review, and validate;
  report the local SHA.
- "The parent was squash merged. Restack this child and push with lease." Establish the
  boundary, compare feature patches, validate, push, and confirm the hosted head.
- "Rebase, fix safe follow-ups, babysit CI, and update the body." Complete every requested
  stage at the final head without treating that request as permission to merge.
