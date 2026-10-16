# Review replies

Findings and replies should be short enough to act on without rereading.

## Findings

- Lead with the defect, then the failing input or state, then the fix if obvious. "`parse`
  returns `0` for `" "`; reject blank input before `Number()`."
- Anchor to the line and name the symbol. Skip "I noticed that" and "It might be worth".
- Separate blocking defects from optional suggestions with a plain prefix such as "nit:".
- No praise padding before or after the finding.

## Replies to feedback

- State the decision first: accepted, declined with a reason, or addressed differently.
- Point to the commit or line that addresses it. "Fixed in abc1234: `close` now awaits the
  drain."
- When declining, give the concrete reason in one or two sentences.
- Drop "Great catch!", "Thanks for the review!", and "Let me know if this works".
- Do not rebuild the reviewer's context. They know the problem; give the decision, the one fact
  they lack, and the commit. Put long diagnosis in an issue or the PR body instead.

## Review summary comments

Use a short paragraph for one finding. Use a table when comparing findings helps, with
location, defect, severity or decision, and the fixing commit where available. Add a summary
only for consequences absent from the findings. Skip preambles and closing offers.
