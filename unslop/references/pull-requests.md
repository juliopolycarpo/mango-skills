# Pull requests

Write for a maintainer deciding whether to merge. Keep the template's headings and fill them
with facts from the current diff.

- Title: the change in a short phrase, following repository title rules. No "Various fixes" or
  "Improvements to X".
- Summary: the problem, then the resulting behavior, at the length the change needs.
- Changes: list notable decisions, not every touched file. Skip items the diff makes obvious.
  Template headings, checklists, and existing tables stay; refresh a table only from a new
  measurement.
- Validation: name the exact commands and results. "Tests pass" says nothing; "`bun run test`
  passes on abc1234" does. Leave unperformed checks unchecked and say why.
- Risk and migration: state what breaks and what users must do. Omit the section's content
  when nothing applies instead of writing "No risks".
- Cut "This PR aims to", "comprehensive", "robust", "seamless", and closing summaries.
- Do not describe the review history. Describe the change as it stands, and re-check the body
  against the diff after every rebase or new commit.
