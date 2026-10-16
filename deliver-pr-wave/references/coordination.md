# Coordinate delegated work

Use this reference when splitting a wave across agents or preparing several worktrees.

## Assignment brief

Use Explorer for mapping, Builder for implementation, and Reviewer for defect review. Give each:

- Goal, acceptance criteria, owned files or module, excluded work, and integration owner.
- Repository, checkout or dedicated worktree, branch, exact base SHA, and expected PR target.
- Required validation, allowed Git/GitHub actions, and expected report of commits, files,
  results, and blockers. Builders do not commit, push, open PRs, or spawn agents unless the
  brief authorizes it.
- A unique scratch directory named after the branch for logs, commit-message files, PR bodies,
  GraphQL queries, and evidence (see [Scratch paths](#scratch-paths)).
- Tell any agent that touches the home directory never to print the user's config files that
  hold credentials.

Tell writers they share the project with others and must accommodate their edits without
reverting them. Prefer a Builder's own worktree. Keep shared files with one coordinator.
Before a Builder finishes, inspect `git log <verified-fetched-base-ref>..HEAD`. If the unit
has a PR, verify its number and repository and inspect its saved body for unrelated text.

## Worktrees and resources

Use separate worktrees for concurrent writers and checks that mutate checkout state. Read-only
inspection may reuse a stable checkout. Retain task-created worktrees until their work is
recoverable and cleanup is within scope. Push only when publication is authorized; otherwise
report unpushed work and preserve its checkout.

Confirm cwd, branch, HEAD, and graph against the expected base before editing. Creation tools
can fork from the default branch instead of the intended feature branch. Create a new worktree
from the recorded base SHA; verify its branch and head before assigning it. Inspect intended
descendant commits in an existing checkout instead of resetting them. Advance a clean checkout
with `--ff-only` only toward its verified intended base when the graph allows it. Correct an
isolated setup error before coding; do not merge an unrelated base. Integrate completed work
using the method agreed in the assignment.

Run the project's frozen install (for Bun repositories `bun install --frozen-lockfile`) in a
fresh worktree before calling a check failure pre-existing; a partial `node_modules` is common.

Stop every dev server, watcher, and runner you start. A leftover process holds the port and
singleton lock for the next worktree.

Before removing a task-created worktree, inspect its status, untracked files, and commits
beyond the merged PR head. Preserve dirty files and unpublished follow-up commits. Confirm
that retained remote refs or another intentional recovery copy contain all work; a merged PR
alone does not prove later work is saved. Respect an existing lock unless this task owns it.
Use ordinary `git worktree remove <path>`, then `git branch -d <branch>` only when its deletion
is in scope and Git accepts it. A refusal is a reason to inspect and retain the work, not to
add force flags. For a squash-merged branch that Git cannot recognize as merged, leave it
unless the task authorizes deletion after verifying its reviewed content is recoverable.

### Disk and build budgets

Set disk, build, and CI concurrency budgets from current free space, filesystem, and runner
limits. Recheck current conditions after resource failures before scheduling more work.

### Recover an orphaned worktree

If a crash or disk-full event leaves a worktree without Git metadata, locate surviving
repository metadata containing the base object and verify it belongs to this project. If none
survives, recover a repository and its base objects before proceeding. Use absolute paths for
`GIT_DIR` (the surviving Git directory) and `GIT_WORK_TREE` (the orphaned files), and an index
path outside the orphaned tree. Create a unique branch-prefixed scratch directory; the index
file inside it must not exist yet. An empty file from `mktemp` is not a valid index.

In a subshell, set those three variables without changing the repository's normal index:

```bash
(
  export GIT_DIR="$surviving_git_dir"
  export GIT_WORK_TREE="$orphaned_worktree"
  export GIT_INDEX_FILE="$branch_scratch_dir/recovery.index"
  git read-tree "$base_ref" &&
    git add -A &&
    git diff --cached --binary "$base_ref" -- > "$branch_scratch_dir/recovery.patch"
)
```

Run from the orphaned worktree root. Check each command's exit status and inspect the patch,
including new and deleted files. `git add -A` follows ignore rules; inspect ignored files
separately and preserve any wanted recovery files before removing the orphaned directory.

## Scratch paths

Concurrent agents may share temporary storage. Generic names such as `pr-body.md`, `commit1.txt`,
or `threads.graphql` can overwrite another task's files. Give
each agent a subdirectory or filename prefix named after its branch for every temp,
commit-message, GraphQL, and PR-body file, and verify what you publish before sending it.

## Polling and CI pacing

Use one coordinator to poll the wave and pace CI submissions. Each unit needs its own current
head, review result, and check evidence after an upstream target changes.

- The coordinator polls checks through paginated REST check runs and commit statuses every
  90 seconds or slower. Keep GraphQL for review threads; avoid duplicate per-agent pollers.
- Use the local [readiness guide](delivery.md#bring-the-current-head-to-readiness) for check
  identity, pagination, review threads, and polling failure handling.
- Inspect queued runs and available runner concurrency before submitting more work. Batch
  changes to avoid needless pushes; preserve required validation coverage.
- Capture raw background output to a file and tail the file. Do not match a poll loop on text
  that the output also quotes, and do not use `pgrep -f` or `pkill -f` patterns that match
  your own command line.

## Common destinations

- Independent PRs left ready: finish requested reviews and CI for each without merging.
- Child changes integrated into an umbrella: serialize integration, validate the resulting
  umbrella, and preserve the owner's final rebase, squash, push, or landing steps.
- Approved wave landed: verify readiness afresh and land each unit in dependency order with
  the [landing guide](landing.md).

A missing authorization affects only its dependent action. Complete authorized preparation
first and do not request approval again for actions already covered by the user's instructions.
