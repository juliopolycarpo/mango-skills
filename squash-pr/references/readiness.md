# Qualify the current PR head

Resolve the repository, PR number, base and published head from live GitHub data. Pass
`--repo <owner/repo>` to PR commands and use explicit repository API paths. Preserve the
user's authorization; a readiness check does not authorize merging or unrelated fixes.

```bash
gh pr view "$pr_number" --repo "$repo_slug" --json \
  number,state,isDraft,baseRefName,headRefOid,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,url
```

## Required gates

- Read the base's live protection and rulesets: `gh api repos/<owner>/<repo>/rulesets`,
  then each applicable ruleset's details and the base's protection. A classic protection
  endpoint returning 404 does not prove that no rules apply.
- Require the current head's checks to pass or be skipped as allowed by the base policy.
  Distinguish workflow, app, run attempt and tested SHA when check names repeat. A canceled,
  superseded run does not invalidate its passing replacement. Lookup errors block readiness.
- Wait for pending CI and reviews required by repository policy. Read configured review
  bots' findings, recent conversation comments and submitted reviews. Do not assume a bot
  is installed or that a green check means its review has completed.
- Inspect every review-thread page and read full discussions before deciding whether the
  current code addresses them. Require zero unresolved threads and no actionable comments.
  An outdated marker does not prove a fix. For feedback within the task, accept it, decline
  with a reason, or explain an alternative; resolve only after verifying the result.
- Require a non-draft PR, a permitted review decision and merge state, and a clean checkout
  with no unpushed task changes. Preserve unrelated work. Missing approval or external failures
  remain explicit gates requiring the appropriate owner action.
- Any head change invalidates earlier qualification. Re-fetch the published SHA, rules,
  checks, comments and threads immediately before landing. Record hosted checks, local checks
  and combined-source evidence separately.

Use `gh pr checks <n> --repo <slug> --watch` to wait for checks, then inspect the final
results and reviews. Exit code 8 from a check lookup means pending checks, not a green set.
For repeated polling, use intervals of 30–60 seconds or slower.

## Every thread page

The last comment is only a preview. This Bash example requires `jq`; supply verified
`repo_owner`, `repo_name` and `pr_number` values. A failed query or missing cursor stops
qualification.

```bash
thread_query='query($owner:String!,$repo:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor}nodes{id,isResolved,isOutdated,path,line,comments(last:1){nodes{author{login},body,url}}}}}}}'
cursor_args=()
while :; do
  page=$(gh api graphql -f query="$thread_query" -f owner="$repo_owner" \
    -f repo="$repo_name" -F number="$pr_number" "${cursor_args[@]}") || exit 1
  jq -e '.errors == null and .data.repository.pullRequest.reviewThreads != null' \
    >/dev/null <<<"$page" || exit 1
  jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)' \
    <<<"$page" || exit 1
  has_next=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' <<<"$page")
  [[ "$has_next" == true || "$has_next" == false ]] || exit 1
  [[ "$has_next" == true ]] || break
  cursor=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor' <<<"$page")
  [[ "$cursor" != null && -n "$cursor" ]] || exit 1
  cursor_args=(-f cursor="$cursor")
done
```

Fetch a thread's full `comments(first:100,after:$cursor)` connection through
`node(id:$threadId){... on PullRequestReviewThread{comments(...) {...}}}`. Follow its
`pageInfo` until `hasNextPage` is false, with the same error checks. Reply with
`addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId,body:$body})`,
then resolve verified fixes with `resolveReviewThread(input:{threadId:$threadId})`. Pass
reply text through a branch-prefixed file (`-F body=@"$reply_file"`), preserve the task's
communication scope, and re-fetch to verify resolution. A REST alternative for replies is `gh api repos/<owner>/<repo>/pulls/<pr>/comments/<comment-id>/replies -F body=@"$reply_file"`.

## Interpret the merge state

`BLOCKED` can mean unresolved threads, required approval or a strict up-to-date rule. Read
the rules and threads before deciding. `mergeStateStatus` ignores bypass permissions;
`--admin` requires explicit authorization and permission under repository policy. Never bypass failing checks or unresolved
threads. Do not infer permission from green checks alone.

`CLEAN` on a feature base does not prove default-branch gates ran. Retargeting requires fresh
checks and review. If strict rules require an up-to-date head, update one branch, qualify it,
land it, then proceed to the next. Prefer `gh pr update-branch`; if token scope prevents a
workflow-file update, integrate the base locally and push within the task's scope. Preserve
history for branches whose existing commits must survive. Stop on conflicts or failed gates.
