# PR status and review threads

Use verified `repo_slug`, `pr_number`, `repo_owner`, and `repo_name` values. Pass the PR and
repository explicitly when working outside its checkout. Query failures must stop the
readiness assessment.

## Status

```bash
gh pr view "$pr_number" --repo "$repo_slug" --json \
  number,state,isDraft,baseRefName,headRefOid,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,url
```

Inspect the live base rules and required checks separately. Check names alone do not
identify the workflow, app, run attempt, or tested SHA.

## Every review-thread page

The final comment is a preview. Fetch the full discussion before responding or resolving.

```bash
thread_query='query($owner:String!,$repo:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor}nodes{id,isResolved,isOutdated,path,line,comments(last:1){nodes{author{login},body,createdAt,url}}}}}}}'
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

Do not cap the sweep at the first 100 threads. Treat invalid data or a missing continuation
cursor as a failed inspection.

## Full thread discussion

For each actionable thread, query its comments. Omit `cursor` on the first page, then pass
the previous `endCursor` while `hasNextPage` is true, with the same error checks as above.

```bash
gh api graphql \
  -f query='query($threadId:ID!,$cursor:String){node(id:$threadId){... on PullRequestReviewThread{comments(first:100,after:$cursor){pageInfo{hasNextPage endCursor}nodes{author{login},body,createdAt,url}}}}}' \
  -f threadId="$thread_id"
```

Read all comments before deciding whether the current head addresses the finding. Inspect
PR conversation comments and submitted reviews as well; review threads are only one source
of feedback.
