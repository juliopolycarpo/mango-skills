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

## Reply to a thread

```bash
gh api graphql \
  -f query='mutation($threadId:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId,body:$body}){comment{url}}}' \
  -f threadId="$thread_id" -F body=@"$reply_file"
```

`addReviewThreadReply` does not exist. `Expected VAR_SIGN, actual: COLON` means shell quoting
split the query; keep the whole query in one single-quoted `-f query=...` argument.
`gh pr view --json comments,reviews` omits inline review threads; use `reviewThreads`.

REST also supports replies to inline review comments:
`gh api repos/<owner>/<repo>/pulls/<pr>/comments/<comment-id>/replies -F body=@"$reply_file"`
(the `<pr>` segment is required, or you get a bare 404). `-f body=@file` posts the literal path
and still succeeds; use `-F` for file input.

## Resolve verified fixes

```bash
gh api graphql \
  -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id,isResolved}}}' \
  -f threadId="$thread_id"
```

Re-fetch to confirm resolution and include the thread in the final sweep. Do not resolve
an actionable finding solely because GitHub marks its old line as outdated.

## Polling

- `gh pr checks --json ...` exits non-zero (8) while any check is pending, though its JSON is
  valid. A loop written `s=$(gh pr checks ...) || continue` never fires; tolerate the exit
  status (`|| true`) and parse the JSON instead.
- Across several PRs, poll REST check runs every 90 seconds or slower and keep GraphQL for
  review threads. Many concurrent `gh pr checks` pollers exhaust the GraphQL rate limit.
- A live job's log comes from `gh api repos/$repo_slug/actions/jobs/$job_id/logs`; `gh run view
  --log` refuses while the run is in progress.
- Poll loops that grep background output can match text the output merely quotes. Redirect raw
  output to a file, wait on an exit status, and inspect the file.
