# Install Mango Skills packages

Download the archives from the repository's
[GitHub Releases](https://github.com/juliopolycarpo/mango-skills/releases), or run
`bun run package` to build them into `dist/`. Every archive in one release or build has the same
version.

| Archive                       | Contents                  | Install it in                                  |
| ----------------------------- | ------------------------- | ---------------------------------------------- |
| `mango-skills-<version>.zip`  | Plugin with every skill   | ChatGPT, Codex CLI, app and IDE extension      |
| `mango-<skill>-<version>.zip` | Plugin with one skill     | ChatGPT, Codex CLI, app and IDE extension      |
| `SHA256SUMS`                  | Checksums of the archives | Run `sha256sum -c SHA256SUMS --ignore-missing` |

Each release also has `release.json`, which records the version, the source commit SHA, a
digest of the packaged payload, a digest per skill, and the SHA-256 of every archive. Check the
downloaded archives before installing them:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

Install either the bundle or individual plugins. Installing both gives you two copies of the
same skill. Plugins are named `mango-skills` and `mango-<skill>`, so Codex lists their skills as
`mango-skills:rebase-pr` or `mango-rebase-pr:rebase-pr`.

Each plugin ZIP holds one plugin directory. Its root `plugin.json` uses the
[Agent Plugins 1.0](https://agent-plugins.org/specification) format. A matching
`.codex-plugin/plugin.json` supports Codex clients that only read that location. Skills are
under `skills/<skill>/` with their references, assets, license notices, and both helper
implementations.

## ChatGPT web and Work

Upload a plugin ZIP from the workspace's plugin settings. Depending on workspace policy, an admin
or a member with plugin upload permission does this. To update, open the plugin's details and
upload the new version's ZIP. Upload a plugin ZIP, not a bare skill directory: ChatGPT's skill
upload rejects a ZIP that holds only `<skill>/SKILL.md`.

ChatGPT validates the archive on upload and scans each skill. Check that every expected skill
appears afterward. OpenAI does not document which runtimes ChatGPT gives skill scripts. The
helpers need Python 3.9+ or Node; text-only workflows do not need either.

## Codex CLI, app and IDE extension

Codex installs plugins from a marketplace, not from a ZIP file. Extract the plugin into a local
marketplace directory:

```text
my-marketplace/
  .agents/plugins/marketplace.json
  plugins/mango-skills/        # extracted from mango-skills-<version>.zip
```

```json
{
  "name": "mango-local",
  "plugins": [
    {
      "name": "mango-skills",
      "source": { "source": "local", "path": "./plugins/mango-skills" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Developer Tools"
    }
  ]
}
```

```bash
codex plugin marketplace add ./my-marketplace
codex plugin add mango-skills@mango-local
```

To update, replace `plugins/mango-skills/` with the new version's contents and run
`codex plugin add mango-skills@mango-local` again. Codex caches each installed version
separately. Do not edit the cache.

The Codex IDE extension runs its own bundled `codex app-server` with the same configuration, so
plugins installed this way are available there too.

## Skill directories

To install skills without a plugin, extract a plugin ZIP and copy the skill directories under its
`skills/` into `~/.agents/skills/` for every project, or into a repository's `.agents/skills/`
for that project. To update, replace the skill directory. Claude and other agents that read skill
directories install the same copies.

## Codex cloud

Codex cloud loads skills committed to the repository, not personal plugins or skills. Copy the
skill directories from a plugin ZIP's `skills/` into the repository's `.agents/skills/` and commit
them. Cloud tasks run without
network access by default, so workflows that call GitHub need it enabled for the environment.

## Verified installs

| Surface                                                                        | Result                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex CLI 0.163.0, Linux                                                       | Bundle and individual plugins install from a local marketplace and list every skill. Updating to a new version reinstalls it. Skills in `~/.agents/skills` are discovered. Helpers run from the installed copy under Node 24 and Python 3.         |
| Codex app 26.1013 on Windows (bundled `codex.exe` 0.163.0-alpha.10.2)          | ZIPs extracted with `Expand-Archive` install from a local marketplace. All bundle skills, the individual plugin's skill and a repository `.agents/skills` skill are discovered. Helpers run from the installed copy under Node 24 and Python 3.14. |
| `codex app-server` 0.163.0, the backend for the Codex app and IDE extension    | `skills/list` reports plugin, user and repository skills with icons and no errors. `plugin/list` reports the plugins as installed and enabled.                                                                                                     |
| Codex IDE extension 26.51007.21434 (bundled `codex` 0.162.0-alpha.17.2, Linux) | The bundled binary installs the bundle and an individual plugin from a local marketplace. Its app-server lists every plugin skill and a repository `.agents/skills` skill with no errors. The extension UI was not opened.                         |
| Python `zipfile`, Info-ZIP, PowerShell `Expand-Archive`                        | Every archive extracts. Python and Info-ZIP also pass CRC checks.                                                                                                                                                                                  |
| ChatGPT web and Work                                                           | The bundle and individual plugin ZIPs upload and work. ChatGPT's skill upload rejected bare skill ZIPs, so releases do not include them.                                                                                                           |
| Codex cloud                                                                    | Skills copied from a plugin ZIP into the repository's `.agents/skills` load and work, confirmed by the maintainer.                                                                                                                                 |
