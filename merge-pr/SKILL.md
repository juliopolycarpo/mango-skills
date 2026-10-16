---
name: merge-pr
description: Use to land an umbrella or import repository history with a signed merge commit while preserving existing commits.
---

# Merge a PR with a true merge commit

Land an umbrella branch or imported history without rewriting its commits. Existing SHAs,
signatures, and sign-offs survive; create the merge locally with standard Git signing.
Apply the consuming repository's certification and attribution policy. The task must authorize landing. This workflow applies only when the
existing history must survive; a one-commit squash requires a different landing method.

## Prepare and qualify

1. Resolve the live PR's base and head repository URLs and branches, including forks. Inspect
   `git remote -v` and verify both fetch and push URLs before selecting `<base-remote>` and
   `<head-remote>`; they may differ. Fetch their branches into distinct local refs, record
   `<fetched-base-ref>` and `<fetched-head-ref>`, and verify those SHAs against the PR. Do not
   assume `origin` is the base repository. Record the original head whose history must survive. Read the live rules and [readiness and merge state](references/readiness.md).
2. If the base is not an ancestor of the umbrella, merge it **into the umbrella** and resolve
   conflicts there. Push the updated branch normally to the verified head remote and branch. Never rebase the history being preserved.
   Confirm `git merge-base --is-ancestor <original-head> <final-head>` succeeds.
3. Qualify the final published head using [readiness](references/readiness.md): checks green,
   actionable threads addressed, merge state current. Any code, conflict resolution, signing repair, or
   branch update changes the head and requires fresh qualification. Record qualified head and
   base SHAs with the validation evidence.
4. Audit the commits to be carried:
   `git log --format='%h|%G?|%(trailers:key=Signed-off-by,valueonly,separator=;)' <base>..<head>`.
   Check signatures and trailers required by repository policy; retain contributor attribution.
   If an existing commit needs rewriting, stop and report the conflict with history preservation.
   Obtain authorization for that repair before replacing commits, then requalify the new head.
5. Fetch again immediately before creating the merge. Check the refs against the qualification
   receipt with `bun <skill-dir>/scripts/javascript/verify-qualified-head.mjs <repo> <base-ref> <head-ref> <qualified-head-sha> <qualified-base-sha>`
   (`node` also works, or `python3 <skill-dir>/scripts/python/verify_qualified_head.py` with the same arguments).
   This read-only check requires exact SHAs and an integrated base; it does not inspect CI or
   reviews. If either ref moved, repeat preparation and qualification.

An unrelated history cannot pass the ancestor check. Prepare its two-parent merge candidate
in an isolated checkout with `--allow-unrelated-histories`, review the combined diff and any
resolutions, and run the required checks on that candidate. Record its SHA, both parents,
qualified tree and checks. If hosted workflows cannot qualify this candidate, report that gap;
do not describe head-only checks as combined-source evidence. Recreate no candidate after
qualification: land the exact signed candidate once its checks and reviews satisfy the gate.

## Create and land

1. Write a unique `<branch>-merge.txt` using the repository's message shape:
   - Subject: `chore[(scope)]: merge <topic> umbrella (#N)`, or
     `chore(scope): merge <repo> standalone history (#N)`.
   - Body: what the branch delivers, its head and commit count, and any merge resolutions.
     Follow repository wrapping and trailer policy; do not invent certification or attribution.
   - Inspect the exact message for private information using [message checks](references/messages.md).
2. Inspect [signing and identity](references/messages.md#signing-and-identity). In a clean
   checkout of the recorded base, run
   `git merge --no-ff --gpg-sign --no-edit -F <file> <qualified-head-sha>`.
   Add `--signoff` only when required and the configured committer can make the certification.
   For unrelated imports, create and sign the candidate before qualification and use that
   already qualified candidate above. Missing signing configuration blocks this workflow.
3. Verify `git log -1 --format='%G?|%P|%(trailers:key=Signed-off-by)'`: good signature, exactly
   two parents (recorded base, qualified head), and trailers meeting repository policy.
   A missing signature or required trailer blocks landing. If repair changes the candidate
   SHA, requalify it before landing; never replace an already qualified import candidate silently. For an ordinary umbrella,
   `git diff --exit-code <qualified-head-sha> HEAD` must be empty. Verify the original head
   remains an ancestor. An unexpected tree change requires qualification of the candidate.
4. Fetch again and ensure the remote base still equals the recorded base and the remote head
   still equals the qualified head. A changed ref invalidates the receipt. Push the candidate
   as a plain fast-forward: `git push <base-remote> HEAD:refs/heads/<base-branch>`. Never force. If rejected, inspect
   the live state and repeat preparation and qualification; never rebase preserved history.
5. Re-fetch and verify the actual merge SHA is on the base and the PR shows merged. Later
   landings may have advanced the base, so verify ancestry rather than assuming tip equality.

## Completion

Report the merge SHA, parents, signature, required trailer and contributor attribution checks, original-head
ancestry, commit count carried, and qualified-tree comparison. Distinguish hosted, local and
combined-source checks. Close or retarget carried child PRs, clean task-created branches and
worktrees when in scope, and update the relevant tracking record when in scope.
