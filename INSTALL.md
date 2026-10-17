# Install Mango Skills packages

`bun run package` builds these archives into `dist/`. Every archive in one build has the same
version.

| Archive                       | Contents                  | Install it in                                  |
| ----------------------------- | ------------------------- | ---------------------------------------------- |
| `mango-skills-<version>.zip`  | Plugin with every skill   | ChatGPT, Codex CLI and app                     |
| `mango-<skill>-<version>.zip` | Plugin with one skill     | ChatGPT, Codex CLI and app                     |
| `skill-<skill>-<version>.zip` | One `<skill>/` directory  | ChatGPT skill upload, any skills directory     |
| `SHA256SUMS`                  | Checksums of the archives | Run `sha256sum -c SHA256SUMS --ignore-missing` |

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
upload the new version's ZIP. To add a single skill without a plugin, upload a `skill-*.zip` under
Skills > Create > Upload from your computer.

ChatGPT validates the archive on upload and scans each skill. Check that every expected skill
appears afterward. OpenAI does not document which runtimes ChatGPT gives skill scripts. The
helpers need Python 3.9+ or Node; text-only workflows do not need either.

## Codex CLI and app

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

## Codex IDE extension and other skill directories

Plugins are not available in the Codex IDE extension. Extract `skill-<skill>-<version>.zip` into
`~/.agents/skills/` for every project, or into a repository's `.agents/skills/` for that
project. To update, replace the skill directory.

## Codex cloud

Codex cloud loads skills committed to the repository, not personal plugins or skills. Extract
the skill ZIPs into the repository's `.agents/skills/` and commit them. Cloud tasks run without
network access by default, so workflows that call GitHub need it enabled for the environment.

## Verified installs

| Surface                                                   | Result                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex CLI 0.163.0, Linux                                  | Bundle and individual plugins install from a local marketplace and list every skill. Updating to a new version reinstalls it. Skills in `~/.agents/skills` are discovered. Helpers run from the installed copy under Node 24 and Python 3. |
| Python `zipfile`, Info-ZIP                                | Every archive extracts and passes CRC checks.                                                                                                                                                                                              |
| ChatGPT web and Work, Codex app, IDE extension, and cloud | Not yet tested. The instructions follow OpenAI's documentation.                                                                                                                                                                            |
