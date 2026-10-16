# Review replies

Findings and replies should be short enough to act on without rereading.

## Findings

- Lead with the defect, then the failing input or state, then the fix if obvious. "`parse`
  returns `NaN` for `" 42"`; trim before `Number()`."
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

When posting a review or a round of fixes as one comment, use a table with one row per finding
(location, finding, severity or decision, commit) followed by two or three sentences on what
changed overall. No preamble and no closing offer.
