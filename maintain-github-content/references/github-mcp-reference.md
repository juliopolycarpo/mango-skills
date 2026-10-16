# GitHub MCP reference

Use GitHub MCP when available and suitable for the task. Tool names may have connector
prefixes and schemas vary by server version, host, enabled toolsets, and permissions.
Discover the installed tools and read their actual schemas before calling them. An absent
capability is a limitation, not authorization to substitute a different write.

## Discover and inspect

Confirm host, repository, authenticated actor, and object identifiers. The upstream GitHub
MCP Server commonly exposes these operations; wrappers may expose only a subset:

| Need                                | Upstream tool and operation                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| Read an issue                       | `issue_read`, `method: get`                                                          |
| Read issue conversation             | `issue_read`, `method: get_comments`                                                 |
| Read a PR                           | `pull_request_read`, `method: get`                                                   |
| Inspect the change                  | `pull_request_read`, `method: get_diff`, `get_files`, or `get_commits`               |
| Inspect PR conversation and reviews | `pull_request_read`, `method: get_comments`, `get_reviews`, or `get_review_comments` |
| Inspect head checks                 | `pull_request_read`, `method: get_check_runs` and `get_status`                       |
| Read templates and policies         | `get_file_contents` at the verified base/default ref                                 |
| Discover candidates                 | `search_issues`, `search_pull_requests`, or the available list tools                 |

Pass explicit `owner` and `repo`. Issue tools commonly use `issue_number`; PR tools use
`pullNumber`. These names are case-sensitive. Verify the returned URL and number before
writing. Status contexts and check runs are separate evidence sources; a status-only
response does not establish all required checks.

Follow each operation's pagination: `page`/`perPage` for page-based lists, or `after` and
returned cursors where supported. `get_review_comments` uses cursor pagination in current
upstream versions. Inspect nested comment completeness as well as thread completeness;
fetch missing pages with a supported tool or the CLI/GraphQL reference. Treat tool errors,
truncated text, and missing continuation data as incomplete reads. Prefer structured
content when supplied, but validate the actual response shape.

## Focused writes

| Authorized change                        | Upstream tool                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| PR title or body                         | `update_pull_request` with `owner`, `repo`, `pullNumber`, and only changed fields                           |
| Issue title, body, or supported metadata | `issue_write`, `method: update`, with `issue_number`                                                        |
| Conversation comment on an issue or PR   | `update_issue_comment` with numeric `comment_id` and `body`                                                 |
| Add an issue or PR conversation comment  | `add_issue_comment` with `issue_number` and `body`                                                          |
| Reply to an inline review comment        | `add_reply_to_pull_request_comment` with `pullNumber`, numeric `commentId`, and `body`                      |
| Resolve a verified review thread         | `pull_request_review_write`, `method: resolve_thread`, with `threadId`, if the installed schema supports it |

For example, after reading and reconciling the current issue, a body-only edit has this
shape. Replace the example values with verified identifiers and the exact prepared text:

```json
{
  "method": "update",
  "owner": "example-owner",
  "repo": "example-repo",
  "issue_number": 42,
  "body": "The exact prepared Markdown body."
}
```

Do not include unrelated optional fields. Arrays such as labels and assignees may replace
the whole collection; preserve current values when only an additive change is authorized.
Discover supported labels, milestones, types, relationship tools, and project field values
before writing. A PR body edit must omit state, draft, base, reviewers, and permission fields.

`update_issue_comment` does not edit inline review comments or submitted review bodies.
If no tool supports the exact operation, use an available authorized CLI/API fallback from
[the CLI reference](gh-reference.md), or report the limitation with the prepared draft.
Do not turn an unsupported edit into a new comment or a new review.

## Verification and failure recovery

Apply the common re-read, reconcile, write, and readback workflow. A successful MCP call
is insufficient: read the object again, compare exact text and requested metadata, and
confirm the PR head SHA. Check every field after a partial failure. Before retrying a
creation, search for its returned ID or matching content to prevent duplicate posts.

A read-only server or missing token permission cannot perform a write. Report the failed
operation and preserve a resumable draft. Do not change server configuration, broaden
permissions, or switch accounts without task authorization. Keep tokens out of text and logs.

## Sources

Verify current schemas against the installed server. Upstream references:

- [GitHub MCP Server tools](https://github.com/github/github-mcp-server#tools)
- [Server configuration and tool availability](https://github.com/github/github-mcp-server/blob/main/docs/server-configuration.md)
