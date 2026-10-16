---
name: prove-regression
description: "Use when fixing a behavioral defect or proving a regression test fails for the reported reason before the fix and passes afterward."
---

# Prove a regression

Show that the test detects the faulty behavior and passes with the fix. A setup failure,
generic panic, or test-runner timeout is not regression evidence.

## Establish the failure

1. Trace the current entry point, callers, contract, tests, and sibling implementations.
   Reproduce the sequence and record the revision, input, environment, expected result, and
   observed result.
2. Write an assertion that separates the defect from the fix. Assert the invalid value and
   expected shape for input errors, or settlement and surviving resources for leaks.
3. Use named fakes for external I/O. Preserve relevant refusal, delay, ordering, and cleanup
   restrictions; record requests and reject unexpected ones. Exercise the actual type and
   triggering event, not a wrapper or an initial state that passes before work begins.

For cancellation, cleanup, queued writers, duplicate publication, clocks, or UI timing, choose
the relevant [async recipe](references/async-recipes.md).

## Prove red, then green

Run the regression against faulty behavior before fixing it. Inspect the failure and exit
status. If it passes, repair the assertion or fake. If setup fails, repair setup before claiming
a red result. Deadline tests must assert the deadline and cleanup instead of hanging the suite.

If the fix already exists or the checkout is shared, use an isolated copy containing the
relevant current and uncommitted work. Restore only the faulty behavior there; never reset
another worker's files. For scripted mutations, assert the source anchor and exact match count,
then inspect the diff. A no-op mutation or unrelated failure proves nothing.

Apply the smallest complete fix and rerun the same regression. Check adjacent callers and
sibling implementations, then run required repository checks through canonical scripts.
Inspect final summaries and exit statuses, including fixtures that print expected failure text.
Fix safe related defects in scope and track larger findings through the owning task.

## Report the proof

Give the red and green commands, exit statuses, intended failure, and evidence locations.
Identify any isolated mutation and unverified platforms or integrations. If automated proof
is unavailable, report the gap and strongest reproduction; do not add an insensitive test to
claim coverage. Ordinary new-function tests do not require an artificial red mutation.
