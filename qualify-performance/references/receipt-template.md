# Performance plan and receipt

Use this structure in the task's evidence destination. Fill the plan before running trials. Keep raw
logs and samples in durable artifacts with links from the receipt. Remove fields unrelated to the
question; mark a required field unavailable rather than inventing it.

## Experiment plan

| Field                 | Value                                                                     |
| --------------------- | ------------------------------------------------------------------------- |
| Question and workload | Exact operation, input size, seed or corpus, scenario boundaries          |
| Primary metric        | Unit, start event, end event, sampling method                             |
| Acceptance gate       | Minimum useful effect, tolerated tradeoffs, correctness requirements      |
| Batch validity        | Required scenarios and inventories, allowed exclusions, worker settlement |
| Sample plan           | Warm-up treatment, number of pairs, run order, retry policy, budget       |
| Baseline              | SHA, source patch or clean status, lockfile hashes                        |
| Candidate             | SHA, source patch or clean status, lockfile hashes, intended change       |
| Build identity        | Toolchain versions, target, features, profile, measured artifact hash     |
| Execution identity    | Platform, runner or machine, resources, filesystem, concurrency           |
| Cache policy          | Dependency, build, task, application, and OS cache conditions             |
| Commands              | Exact setup, warm-up, timed, correctness, and cleanup commands with cwd   |
| Evidence location     | Raw logs, resource samples, artifacts, plan owner                         |

For a useful-screen or startup experiment, name the observable event instead of assuming that process
creation or a page load event means the product is ready. For sampled memory, record the interval and
process scope. For hosted CI, identify the run, job, attempt, source SHA, and runner class.

## Raw attempts

Use one row per attempt, including failures and retries. Link a detailed record when command output
or resource samples do not fit a table.

| Attempt           | Pair and order           | Side                  | Source or artifact | Exit or status                         | Metric and unit               | Validity and reason                   | Raw receipt  |
| ----------------- | ------------------------ | --------------------- | ------------------ | -------------------------------------- | ----------------------------- | ------------------------------------- | ------------ |
| Unique attempt ID | Pair ID, first or second | Baseline or candidate | Exact identity     | Success, failure, canceled, incomplete | Observed value or unavailable | Declared rule and supporting evidence | Durable link |

Each detailed record needs its timestamps, exact command, cwd, environment identity, cache condition,
exit status, measured values, and log links. Preserve stderr and the final command summary. Record a
warm-up attempt as warm-up even when its time looks useful.

Do not silently pool several platforms, workloads, runner classes, build profiles, or cache states.
They are separate comparisons unless the experiment explicitly defines how to combine them.

## Evaluation

| Scenario and condition          | Valid pairs | Baseline summary               | Candidate summary       | Paired delta and noise   | Gate               | Outcome                                       |
| ------------------------------- | ----------- | ------------------------------ | ----------------------- | ------------------------ | ------------------ | --------------------------------------------- |
| Workload, platform, cache state | Count       | Appropriate statistic and unit | Same statistic and unit | Distribution or interval | Original threshold | Accepted, rejected, inconclusive, unqualified |

State how summaries and deltas were computed. Keep individual samples available. Explain invalid
attempts and missing scenarios before drawing a conclusion. For small samples, show the samples and
spread rather than adding unsupported statistical precision.

## Handoff

- State the decision and the evidence supporting it, including correctness and resource tradeoffs.
- Identify limits such as an untouched baseline failure, unpaired runners, synthetic inputs, external
  service variation, missing platform evidence, or a later source head.
- Record source-confirmed concerns and unmeasured hypotheses separately from measured outcomes.
- State what implementation or delivery occurred, who owns remaining work, and the evidence needed
  to resume. A passing experiment does not itself record deployment or landing.
