# Pull requests

Write for a maintainer deciding whether to merge. Keep the template's headings and fill them
with facts from the current diff.

- Title: the change in a short phrase, following repository title rules. No "Various fixes" or
  "Improvements to X".
- Summary: the problem, then the resulting behavior, at the length the change needs.
- Changes: list notable decisions, not every touched file. Skip items the diff makes obvious.
  Keep required template headings and checklists. Preserve valid measurement receipts with
  their original SHA and conditions; update measured values only from a new measurement.
  Correct or remove inaccurate or obsolete table rows using evidence, including nonmeasurement
  matrices and claims invalidated by source inspection.
- Validation: name the exact commands and results. "Tests pass" says nothing; "`bun run test`
  passes on abc1234" does. Leave unperformed checks unchecked and say why.
- Risk and migration: state what breaks and what users must do. Omit the section's content
  when nothing applies instead of writing "No risks".
- Cut "This PR aims to", "comprehensive", "robust", "seamless", and closing summaries.
- Do not describe the review history. Describe the change as it stands, and re-check the body
  against the diff after every rebase or new commit.
