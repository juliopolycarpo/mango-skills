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

## CLI targeting and inspection

Use verified variables: `repo_slug` is `[HOST/]OWNER/REPO`, `repo_owner` and `repo_name`
identify the API repository, and each number or ID comes from a live lookup. For an
enterprise host, set the matching API hostname with `gh api --hostname`. Confirm the
active identity with `gh api user --jq .login`; never print tokens.

```bash
gh pr view "$pr_number" --repo "$repo_slug" --json number,url,title,body,baseRefName,headRefName,headRefOid,commits,files,closingIssuesReferences,isDraft,state,statusCheckRollup,reviews,updatedAt
gh pr diff "$pr_number" --repo "$repo_slug"
gh issue view "$issue_number" --repo "$repo_slug" --json number,url,title,body,state,labels,assignees,milestone,updatedAt
gh api --paginate "repos/$repo_owner/$repo_name/issues/$issue_number/comments?per_page=100"
gh api --paginate "repos/$repo_owner/$repo_name/pulls/$pr_number/files?per_page=100"
gh api --paginate "repos/$repo_owner/$repo_name/pulls/$pr_number/commits?per_page=100"
```

`gh pr diff` accepts one PR argument and has no `--stat`; use `--name-only`, `--patch`,
or a local diff for statistics. Save structured JSON when output might be truncated.
When scanning template checkboxes, match only `^- \[[ x]\] `; CI links can resemble
checkboxes.

List and search commands are capped. Use explicit `--limit`, disclose the cap, and use
paginated APIs for a complete inventory. Paginate nested GraphQL connections separately;
an outer cursor does not fetch every comment in each thread. Check GraphQL `errors` even
when HTTP succeeds. Do not treat a failed lookup as an empty collection.

```bash
gh issue list --repo "$repo_slug" --state all --limit 100 --search "$issue_keywords"
gh pr list --repo "$repo_slug" --state open --limit 100 --json number,url,title,headRefOid
gh api --paginate "repos/$repo_owner/$repo_name/labels?per_page=100"
gh api --paginate "repos/$repo_owner/$repo_name/milestones?state=all&per_page=100"
```

Fetch templates from GitHub contents at the verified target ref or a freshly fetched Git
ref. With a local checkout, discovery and reads can use:

```bash
git ls-tree -r --name-only "$base_ref" | rg -i 'pull_request_template|issue_template|contributing'
git show "$base_ref:$template_path"
```

## Edit titles and bodies

Save exact Markdown with real newlines to a unique task file (`body_file`). Shell command
text is code; avoid interpolating untrusted titles or bodies into executable commands.
Re-read immediately before writing, reconcile concurrent edits, and apply only requested
fields. Omit `--title` or `--body-file` when that field is outside the task.

```bash
gh pr edit "$pr_number" --repo "$repo_slug" --title "$new_title" --body-file "$body_file"
gh pr view "$pr_number" --repo "$repo_slug" --json title,body,headRefOid,url,updatedAt
```

```bash
gh issue edit "$issue_number" --repo "$repo_slug" --title "$new_title" --body-file "$body_file"
gh issue view "$issue_number" --repo "$repo_slug" --json title,body,state,url,updatedAt
```

Compare returned title/body with the intended text, not just exit status. Confirm the PR
head still matches the inspected evidence. For authorized metadata changes, consult local
`gh pr edit --help` or `gh issue edit --help`; use additive/removal flags for labels,
assignees, milestones, and project membership. Verify project fields through the Projects
API or `gh project` after inspecting its current schema and permissions. Changing labels
or reviewers can invoke automation; do not bundle it into a body-only task.

## Edit or add comments

Use numeric IDs from the correct API surface. `comment_file` contains the exact new body.
`-F body=@file` reads a file; `-f body=@file` posts the literal path.

Conversation comment on either an issue or a PR:

```bash
gh api --method PATCH "repos/$repo_owner/$repo_name/issues/comments/$comment_id" -F body=@"$comment_file"
gh api "repos/$repo_owner/$repo_name/issues/comments/$comment_id"
```

Inline review comment:

```bash
gh api --method PATCH "repos/$repo_owner/$repo_name/pulls/comments/$comment_id" -F body=@"$comment_file"
gh api "repos/$repo_owner/$repo_name/pulls/comments/$comment_id"
```

Submitted review body uses `PUT repos/OWNER/REPO/pulls/NUMBER/reviews/REVIEW_ID` with a
`body` field. Verify the author, review ID, and permissions before editing.

When posting is authorized, create one conversation comment or reply to an existing inline
review comment. Choose exactly one surface; these are alternatives.

```bash
gh api --method POST "repos/$repo_owner/$repo_name/issues/$issue_number/comments" -F body=@"$comment_file"
```

```bash
gh api --method POST "repos/$repo_owner/$repo_name/pulls/$pr_number/comments/$comment_id/replies" -F body=@"$comment_file"
```

Retain the returned ID and URL and read that exact object back. Never retry a timed-out
creation before checking whether it succeeded. Avoid `--edit-last` when a specific comment
was requested. Resolve authorized, verified review threads through GraphQL using their
thread node ID, then re-fetch the thread state:

```bash
gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id,isResolved}}}' -f threadId="$thread_id"
```

## Sources

Consult installed `--help` first; host support and CLI versions vary.

- [PR editing](https://cli.github.com/manual/gh_pr_edit)
- [Issue editing](https://cli.github.com/manual/gh_issue_edit)
- [API requests and pagination](https://cli.github.com/manual/gh_api)
- [Issue and PR conversation comments](https://docs.github.com/en/rest/issues/comments)
- [Inline review comments](https://docs.github.com/en/rest/pulls/comments)
- [Submitted reviews](https://docs.github.com/en/rest/pulls/reviews)
