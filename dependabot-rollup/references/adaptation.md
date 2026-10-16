# Adapt changed contracts and qualify performance

## SDK and library adaptation

Read project-owned adapters, consumers, tests, manifests and lockfiles. Record exact old and
requested versions, features, toolchains and release-age policy. Compare official vendor
release notes, documentation and relevant source; record links and distinguish supported
contracts from observations of one installation.

Trace changed errors, cancellation, resource ownership, cleanup, deadlines, event order,
capabilities, configuration and wire formats through callers. Separate required adaptation,
compatible behavior needing proof, and unaffected paths. Translate vendor changes inside
project-owned interfaces. Remove compatibility branches only when supported versions are dropped.

Update lockstep pins, regenerate lockfiles, and explain unrelated dependency movement. Keep
release-age exceptions limited to their approved version and invocation. Regenerate schemas
and capture fixtures with repository tooling at the verified vendor version; do not invent
vendor transcripts or retain credentials. Label permitted synthetic fixtures as synthetic.
Review provisioning, examples and install snippets. Recalculate deadlines and cleanup margins
when upstream bounds change.

For changed behavior, first run a focused regression that fails for the intended behavior,
then apply the adaptation and demonstrate a pass. Use an isolated copy if the failing run would
disturb other work. Exercise affected failures, stalled dependencies, cancellation and resource
ownership. Where compatible, compare the old dependency too; a compile failure proves a type
change rather than a runtime defect. Run required checks and affected protocol, package-consumer
and native lanes omitted by root scripts. Report live vendor runs, fixtures, fakes, and unperformed
platforms separately. An assessment request ends with findings; it does not authorize adaptation.

## Performance evidence

Define the claim, workload, metric and units, acceptance threshold, sample count, balanced or
randomized paired run order, budget and exclusion rules before measuring. Define the useful
startup event or artifact, correctness gate, worker cleanup, cache states and required scenarios.
Distinguish wall time, CPU time, peak RSS, sampled memory, queue delay, runner time, size and cost.

Record baseline and candidate source SHAs, patches, lockfile hashes, toolchains, features,
targets, profiles, commands, artifacts and environment. Prepare independent sources with
isolated writable output and matching resources, filesystem, cache state and concurrency.
Separate setup from timed work. An empty build directory does not prove a machine-cold run.
Keep raw samples, order, logs, statuses, hashes, resource measurements, and failed, canceled,
incomplete or retried attempts. Verify the intended workload ran and workers settled. Apply
only predeclared exclusions. If a workload changes, retain original attempts and label a new
experiment. Missing required scenarios leave qualification incomplete.

Report paired deltas, sample count, variability, uncertainty, correctness and resource tradeoffs,
and an accepted, rejected, inconclusive or unqualified result with its reason. Uncontrolled or
unpaired runs are exploratory. Avoid stable percentile claims from too few samples. WSL does
not qualify native Windows or macOS. Cost claims need an identified billing model and current
rate. Release notes and a successful upgrade alone do not prove a product speedup.
