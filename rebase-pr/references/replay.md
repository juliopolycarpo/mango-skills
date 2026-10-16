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

1. Record the child's old head and remote head before changing it. Obtain the parent's final
   `headRefOid` with `gh pr view "$parent_pr" --json headRefOid`, even if its branch was
   deleted. The final parent head describes reviewed parent content; it is not necessarily
   the boundary from which this child branched.
2. Recover `old_feature_base`, the exact parent commit already included in the child's old
   history, from a recorded stack boundary, recovery ref, or reflog. If the child incorporated
   later parent updates, identify the last incorporated parent boundary. The final parent head
   is usable only when ancestry and inspection prove it is that boundary. A merge-base with a
   rewritten parent can omit old parent commits and is insufficient evidence on its own.
   Inspect `git log --oneline "$old_feature_base..$old_head"` and the corresponding diff;
   require that they contain only intended child work. If the boundary cannot be established,
   preserve the child and report the missing evidence before replaying it.
3. Verify the boundary is an ancestor, then replay from that boundary:

   ```bash
   git merge-base --is-ancestor "$old_feature_base" "$old_head" &&
     git rebase --onto "$base_ref" "$old_feature_base"
   ```

   Stop if the ancestry check fails. Compare the old and new feature ranges with
   `git range-diff "$old_feature_base..$old_head" "$base_ref..HEAD"`. Inspect changes between
   the old parent content and the landed parent content, including deliberately removed
   patches, and verify those removals remain absent. A clean replay is insufficient proof.
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
