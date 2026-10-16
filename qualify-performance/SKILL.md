---
name: qualify-performance
description: "Use to compare performance, memory, startup, build size, or CI cost with controlled measurements and an evidence receipt."
---

# Qualify performance

Test a defined claim under recorded conditions. Keep measured results, source-confirmed
concerns, and hypotheses separate. Correctness checks alone do not prove a speedup.

## Plan before measuring

Use the [plan and receipt template](references/receipt-template.md). Define the workload,
metric and units, acceptance threshold, sample count, run order, and budget. Set validity
rules for warm-ups, exclusions, required scenarios, correctness, and worker cleanup.

Name the useful startup event or build artifact being measured. Distinguish wall time, CPU
time, peak RSS, sampled memory, queue delay, job duration, total runner time, size, and cost.
Record which metric decides acceptance and which tradeoffs matter.

## Run comparable trials

1. Record exact baseline and candidate source SHAs, dirty patches, lockfile hashes, toolchains,
   features, targets, profiles, commands, and measured artifact identities.
2. Verify the current platform, resources, filesystem, runner class, concurrency, and relevant
   external conditions. Define dependency, build, application, and OS cache states separately.
   An empty build directory does not establish a machine-cold run.
3. Prepare independent sources under matching conditions. Isolate writable build outputs.
   Name bundled changes or unavoidable differences, and separate setup from timed work.
4. Pair runs on the same workload and balance or randomize their order. Run concurrently only
   when the experiment explicitly controls contention.
5. Keep raw samples, order, logs, exit statuses, hashes, and resource measurements, including
   failed, canceled, incomplete, and retried attempts. Verify the intended workload ran and
   workers settled. Apply only the declared exclusion rules; retries do not erase attempts.

If a workload or gate must change, retain the original attempts and start a new labeled
experiment. Missing required scenarios or evidence leave the batch incomplete. Unpaired or
uncontrolled measurements are exploratory observations. Linux or WSL cannot qualify native
Windows or macOS behavior.

## Decide from the evidence

Report samples, paired deltas, variability, and uncertainty appropriate to the sample count.
Do not claim stable percentiles from too few samples. Evaluate validity before acceptance,
then record an accepted, rejected, inconclusive, or unqualified result with its reason.

Include correctness and resource tradeoffs. Calculate total runner time separately from wall
time; monetary claims need an identified billing model and current rate. Preserve the user's
operational priorities and retain useful correctness fixes even if their performance premise
fails. Link evidence and state the limits of the conclusion.
