# Manual toolchain upgrades

Read for a requested Bun, Rust, compiler or build-tool upgrade. Keep the selected version and
scope explicit. A toolchain update does not automatically include every newer dependency or
every optimization mentioned in its release notes.

## Discover all version consumers

Read root scripts and repository setup instructions first. Search the previous version and the
tool's installation commands across manifests, lockfiles, CI actions, composite actions, images,
development containers, hooks, scripts and contributor guidance. Record any intentionally separate
build, MSRV and package-consumer versions.

For Bun repositories, inspect `packageManager`, `engines`, `bunfig.toml`, setup-bun steps and the
release-age policy. Prefer the manifest as the CI version source where the repository supports it.
Check that browser installation, test CLI execution and workers all use the intended runtime;
invoking a CLI through a package runner alone does not prove its shebang uses Bun.

```bash
bun --version
bun install --frozen-lockfile
```

Use the repository's pinned Playwright dependency. Where the repository runs Playwright on Bun,
its installation route may be `bun --bun playwright install --with-deps chromium`; keep browser
selection and system-package installation within the requested setup scope. Prefer existing
scripts over copying this example blindly.

## Check semantic changes in the tooling

- A compiler alias, such as a native TypeScript package, may escape the bot's ordinary dependency
  scan. Verify its actual package and selected version instead of treating the alias as a release.
- Replacing a typechecker must preserve framework-generated types, diagnostics, ignore rules,
  exit status and every required language. Test an isolated invalid source so the gate proves
  it rejects the intended error. Do not drop framework checks merely because a new command passes.
- Bun process APIs and platform-specific return values can change. Trace affected callers and
  add a regression where the upgrade exposes a real incompatibility.
- For Rust, distinguish the developer toolchain, source-build MSRV, published crate MSRV, lockfile
  compatibility and enabled feature sets. Update and validate only the boundaries in scope.
- Review hooks with the actual remote range and contributor identities. Do not disable commit,
  signature or sign-off checks to make a toolchain migration pass.

## Validate the final environment

Install using the documented version, regenerate the lockfile when needed, then verify a frozen
installation. Run required repository gates plus affected provisioning, compiler-negative,
protocol and native lanes. State which commands used caches and which platforms were not run.

Keep the version bump separate from independent adoption of new tooling features. Qualify a
claimed speedup with the local [performance evidence guide](adaptation.md#performance-evidence); release notes
and a successful upgrade alone do not establish a product performance gain.
