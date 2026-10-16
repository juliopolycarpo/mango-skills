# Find the current base template

Use a freshly fetched base ref or GitHub's base-branch contents. A stale remote-tracking ref
does not prove the current template. Read `CONTRIBUTING.md` and title rules from that base too.

Search case-insensitively in this order:

1. `.github/PULL_REQUEST_TEMPLATE.md`
2. `docs/PULL_REQUEST_TEMPLATE.md`
3. `PULL_REQUEST_TEMPLATE.md`
4. `.github/PULL_REQUEST_TEMPLATE/*`
5. `docs/PULL_REQUEST_TEMPLATE/*`
6. `PULL_REQUEST_TEMPLATE/*`

```bash
git ls-tree -r --name-only "$base_ref" | rg -i 'pull_request_template'
git show "$base_ref:$template_path"
```

For multiple templates, use the one whose headings match the body. If none match, use the
default single file, or `default.md`/`pull_request_template.md` in a template directory.

Keep the template's required headings and checkbox lists. Remove instructional placeholders
after filling a section. If no template exists, describe what changed, why, how it was
verified, and relevant issues without inventing extra sections.
