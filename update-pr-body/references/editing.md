# Read, save, and verify PR metadata

Use verified `pr_number` and `repo_slug` values. Read the current hosted change even when a
local checkout exists.

```bash
gh pr view "$pr_number" --repo "$repo_slug" --json \
  number,url,title,body,baseRefName,headRefName,headRefOid,commits,files,closingIssuesReferences,isDraft,state,statusCheckRollup,reviews
gh pr diff "$pr_number" --repo "$repo_slug"
```

`gh pr diff` takes at most one PR argument and has no `--stat`; use `--name-only`, `--patch`,
or local `git diff --stat <base>...HEAD`. Save targeted `--json` fields to a file instead of
parsing truncated `gh pr view` output. When scanning a body for template checkboxes, match only
`^- \[[ x]\] `; CI links can look like checkboxes.

Read relevant review threads with full pagination using the local
[query reference](github.md#every-review-thread-page), then read every comment page in each
relevant thread. A preview or the PR's top-level comments alone omits inline discussion.

Find candidate issues from the existing body, commit messages, branch, and related issues.
Verify each before using a closing keyword.

```bash
gh issue list --repo "$repo_slug" --state open --limit 20 --search "$issue_keywords"
```

The list is discovery, not proof that no other issue exists. Check named issues directly,
including closed issues and cross-repository references.

Write the exact proposed Markdown to a unique body file with real newlines. Re-fetch the
PR immediately before editing; reconcile changes to head, title, or body before proceeding.

```bash
gh pr edit "$pr_number" --repo "$repo_slug" --title "$new_title" --body-file "$body_file"
gh pr view "$pr_number" --repo "$repo_slug" --json title,body,headRefOid,url
```

Compare the returned text to the intended title and body. If the head changed, audit the
new diff and evidence before reporting the metadata as current. A draft-only request never
reaches the edit command.
