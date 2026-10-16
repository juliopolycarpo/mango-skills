# Async regression recipes

Choose the recipe that forces the reported ordering. Prefer explicit gates or the repository's
deterministic scheduler to real sleeps. A gate also makes the failure describe the sequence that
actually occurred.

## Cleanup and a stalled child

Use a named fake child that can remain alive after graceful shutdown. It must distinguish graceful
requests, forced termination, waiting, and completion. Preserve the real contract for duplicate calls
and failed cleanup instead of silently accepting them.

Start the child, confirm the operation reached the relevant wait, trigger the failure or cancellation,
and assert the returned status and the count of children still owned by the operation. A rejected
promise or returned error can coexist with a surviving child. Check both.

Use bounded polling for eventual process settlement. On exhaustion, include the deadline and last
observed state or live-child count in the failure. Keep cleanup in the test's failure path so a red
result does not contaminate later tests.

## A queued writer after failure

Stall the first write after submission and confirm a second writer has queued. Trigger cancellation
or transport failure before releasing the first writer. Let both operations settle.

Assert the exact number and contents of submitted requests through the transport under test. A
correct return value from the second writer does not prove it avoided sending. Check that the queued
writer never submits after the shared failure state takes effect.

## Two publishers and the losing order

Arrange two actors that can publish the same terminal result. Force the actor that should lose to
observe cancellation before its waiter receives a poll. A current-thread runtime or explicit
scheduler gates can make this order reproducible when the repository supports them.

Wait for both actors to settle, then assert the exact publication count and result. An assertion that
only checks whether some result arrived cannot catch duplicate publication.

## Polls, deadlines, and fake clocks

Inject one monotonic clock for both deadline calculation and elapsed-time checks. A fake `sleep` must
advance that clock, or the test must advance it while yielding to the pending operation. A constant
`now()` with instant `sleep()` can spin forever.

Check the shared deadline across retries or members when the contract gives the whole operation one
budget. Bound the polls independently so a broken implementation fails with the last observed state
rather than hanging the suite.

## Cancellation across awaits

For a defect involving ownership or repeated work, identify the await that transfers ownership or
publishes state. Drop or cancel the future on the relevant side of that await and inspect the
observable request count, retained state, or resource census.

Add another iteration when the failure depends on reuse. One successful call cannot prove that a
second call, abandoned future, or already-spent session follows the same contract.

## UI completion

Wait for evidence that the triggering request or event reached the system, then flush the relevant
scheduled work before asserting the final state. An assertion against the initial render can pass
before the request begins.

If the defect has no reliable automated signal in the repository's renderer, report that limitation
and the manual reproduction. Avoid replacing the behavior with an assertion about source text or a
mock that already returns the desired result.
