# Repair a broken squash message

Use only for an incorrect squash message or policy-required trailers while the squash is
still the default-branch tip. The task must authorize rewriting and repository policy must
permit it. Inspecting a failed verification does not authorize a force-push. If another
commit has landed on top, stop; rewriting a larger range is outside this workflow.

1. Read the PR's base repository URL and branch. Verify `<base-remote>` has matching fetch
   and push URLs; a fork's `origin` may point elsewhere. Fetch that branch into the recorded
   `<fetched-base-ref>` and record `old=$(git rev-parse <fetched-base-ref>)`. Confirm it is the
   PR's actual squash and still the base repository's remote tip. Record its tree, parents
   and existing attribution.
2. Check out `old` in a clean worktree. Write the corrected message to a branch-prefixed file,
   retaining legitimate contributor trailers and following the [message shape](shapes.md).
3. Run `git commit --amend -F <file>`, adding `-S` when signatures are required and `--signoff`
   only for a required certification the configured committer can make. Inspect active
   tooling and existing trailers first to avoid duplicates. Do not include staged changes.
4. Prove only the message changed: compare old and new tree IDs and parent lists, and confirm
   `git diff --stat <old> HEAD` prints nothing. Inspect the actual message, required signature
   and trailers. A signature header alone is insufficient verification.
5. Re-fetch and confirm the remote base is still `old`. Push only with an exact lease:
   `git push --force-with-lease=refs/heads/<base-branch>:<old> <base-remote> HEAD:refs/heads/<base-branch>`. Do not bypass protection
   without explicit authorization and repository permission.
6. Re-fetch and verify the replacement. Record old and replacement SHAs. Identify dependent
   branches whose history includes `old`; a replay may require
   `git rebase --onto <fetched-base-ref> <old>` on the affected branch. Report required follow-up;
   do not rewrite or message other contributors' branches without authorization.
