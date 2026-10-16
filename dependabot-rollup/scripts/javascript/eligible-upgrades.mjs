#!/usr/bin/env bun
/** Read-only dependency release-age inventory. Example: bun eligible-upgrades.mjs --base origin/main --json */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const sections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const stable = /^v?(\d+)\.(\d+)\.(\d+)$/;
const key = (v) => stable.exec(v)?.slice(1).map(Number);
const compare = (a, b) => {
  const x = key(a),
    y = key(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const normalize = (v) => v.replace(/^v/, "");
const identity = (row) => `${row.path}#${row.section}:${row.name}`;

/** Check a stable version against `^x.y.z`, `~x.y.z` or exact `x.y.z` using npm semantics; any other spec is false. Example: satisfiesRange('1.2.5', '^1.0.0'). */
export function satisfiesRange(version, spec) {
  const current = key(version);
  const match = /^([~^]?)(\d+)\.(\d+)\.(\d+)$/.exec(spec);
  if (!current || !match) return false;
  const lower = match.slice(2).map(Number);
  const [major, minor, patch] = lower;
  const order = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  if (!match[1]) return order(current, lower) === 0;
  const upper = match[1] === "~"
    ? [major, minor + 1, 0]
    : major > 0
    ? [major + 1, 0, 0]
    : minor > 0
    ? [0, minor + 1, 0]
    : [0, 0, patch + 1];
  return order(current, lower) >= 0 && order(current, upper) < 0;
}

const yamlKey = /^("[^"]*"|'[^']*'|[^\s:#'"\[{][^:]*?)\s*:(?:\s+(.*))?$/;
const yamlExplicitKey = /^\?\s+("uses"|'uses'|uses)\s*$/;
const yamlExplicitValue = /^:(?:\s+(.*))?$/;
const yamlBlockScalar = /^[|>][+-]?\d?[+-]?\s*(?:#.*)?$/;
const yamlNonString = /^(?:~|null|true|false|[-+]?[\d_.]+(?:e[-+]?\d+)?)$/i;
const yamlProperty = /^(?:&\S+|!\S*)(?:\s+|$)/;
const yamlUnreadable = "*%@`|>&!";

/** Index of the closing quote in `text` (which starts after the opening quote), or -1. Example: yamlClose("a'' b' c", "'"). */
function yamlClose(text, quote) {
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote === "\"" && char === "\\") index++;
    else if (char === quote && quote === "'" && text[index + 1] === "'") index++;
    else if (char === quote) return index;
  }
  return -1;
}

/** Decode the quoted scalar that starts `value`, or null when its closing quote is missing. Example: yamlQuoted("'it''s'"). */
function yamlQuoted(value) {
  const end = yamlClose(value.slice(1), value[0]);
  if (end < 0) return null;
  const inner = value.slice(1, end + 1);
  return value[0] === "\"" ? inner.replace(/\\(["\\/])/g, "$1") : inner.replaceAll("''", "'");
}

/** Classify a YAML value after dropping anchors and tags. Example: yamlValue('&a "owner/x@v1"') is {type: 'string', value: 'owner/x@v1'}. */
function yamlValue(raw) {
  let value = raw.trim();
  let hadProperty = false;
  for (let match = yamlProperty.exec(value); match; match = yamlProperty.exec(value)) {
    value = value.slice(match[0].length);
    hadProperty = true;
  }
  const unreadable = { type: hadProperty ? "unreadable" : "empty" };
  if (!value || value[0] === "#") return unreadable;
  if (value[0] === "\"" || value[0] === "'") {
    const quoted = yamlQuoted(value);
    return quoted === null
      ? { type: "open-quote", quote: value[0] }
      : { type: "string", value: quoted };
  }
  if (yamlBlockScalar.test(value)) return { type: "block" };
  if (value[0] === "{" || value[0] === "[") return { type: "flow", text: value };
  if (yamlUnreadable.includes(value[0])) return { type: "unreadable" };
  const plain = value.split(/\s#/)[0].trim();
  return !plain || yamlNonString.test(plain) ? { type: "empty" } : { type: "string", value: plain };
}

/** Remove a trailing comment from a raw value. Example: yamlRaw('*co # note') is '*co'. */
const yamlRaw = (raw) => raw.split(/\s#/)[0].trim();

/** Scan one flow-collection line: nesting depth, open quote and the line without comments. Example: yamlFlowLine('{a: 1,', 0, null). */
function yamlFlowLine(line, depth, quote) {
  let clean = "";
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quote !== null) {
      clean += char;
      if (quote === "\"" && char === "\\") clean += line[++index] ?? "";
      else if (char === quote && quote === "'" && line[index + 1] === "'") clean += line[++index];
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) break;
    const previous = clean.trimEnd().slice(-1);
    if ((char === "\"" || char === "'") && (previous === "" || "{[,:".includes(previous))) {
      quote = char;
    } else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
    clean += char;
  }
  return { depth, quote, clean };
}

/** Emit what a `uses` value yields: strings as-is, anything unreadable as its raw text. Example: yamlEmit({type: 'string', value: 'a/b@v1'}, '', found). */
function yamlEmit(value, raw, found) {
  if (value.type === "string") found.push(value.value);
  else if (value.type !== "empty") found.push(yamlRaw(raw));
}

/** Collect `uses` values from a complete flow collection (`{...}` or `[...]`). Example: yamlFlow('{uses: a/b@v1}', found). */
function yamlFlow(text, found) {
  let index = 0;
  const skip = () => {
    while (index < text.length && /\s/.test(text[index])) index++;
  };
  const scalar = () => {
    const start = index;
    if (text[index] === "\"" || text[index] === "'") {
      const end = yamlClose(text.slice(index + 1), text[index]);
      index = end < 0 ? text.length : index + end + 2;
    } else {
      while (index < text.length && !",[]{}".includes(text[index])) {
        if (text.startsWith("${{", index)) {
          index = text.indexOf("}}", index) < 0
            ? text.length
            : text.indexOf("}}", index) + 2;
        } else if (
          text[index] === ":" && (index + 1 >= text.length || /[\s,\]}]/.test(text[index + 1]))
        ) break;
        else index++;
      }
    }
    const raw = text.slice(start, index).trim();
    const value = yamlValue(raw);
    return { raw, key: value.value, value };
  };
  const node = () => {
    skip();
    const start = index;
    if (text[index] !== "{" && text[index] !== "[") return scalar();
    const close = text[index++] === "{" ? "}" : "]";
    for (;;) {
      skip();
      if (index >= text.length) break;
      if (text[index] === close) {
        index++;
        break;
      }
      if (text[index] === ",") {
        index++;
        continue;
      }
      const before = index;
      const key = node();
      skip();
      if (text[index] === ":") {
        index++;
        skip();
        const value = ",]}".includes(text[index] ?? ",")
          ? { value: { type: "empty" }, raw: "" }
          : node();
        if (key.key === "uses") yamlEmit(value.value, value.raw, found);
      }
      if (index === before) index++;
    }
    const raw = text.slice(start, index);
    return { raw, key: undefined, value: { type: "flow", text: raw } };
  };
  node();
}

/**
 * Dependency-free extraction of `uses:` string values, in document order, so Node and Bun agree.
 * Supported subset: block-style `uses:` / `- uses:` and explicit `? uses` keys at any depth;
 * plain, single/double quoted values with trailing `# comments`; `&anchor` and `!tag` prefixes
 * (dropped); `{...}` / `[...]` flow collections, also across lines, scanned for `uses` keys;
 * `|`/`>` block scalars and unclosed quoted scalars (their continuation lines are skipped, so
 * their text is never read as a key). A `uses` value that cannot be read (alias `*x`, block
 * scalar, flow collection, unclosed quote, bare anchor/tag, reserved indicator) is returned as
 * its raw text so it surfaces as an unsupported declaration instead of disappearing.
 * Empty inline values retain their indented continuation as unsupported `uses:` text.
 * Not supported: resolving multi-line plain scalars, aliases, or validating YAML syntax.
 * Example: extractUses('steps:\n  - uses: actions/checkout@v4 # pin').
 */
export function extractUses(source) {
  const found = [];
  let blockParent = null;
  let quote = null;
  let flow = null;
  let explicit = false;
  const lines = source.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\r+$/, "");
    if (quote !== null) {
      if (yamlClose(line, quote) >= 0) quote = null;
      continue;
    }
    if (flow !== null) {
      const next = yamlFlowLine(line, flow.depth, flow.quote);
      flow = { depth: next.depth, quote: next.quote, text: `${flow.text} ${next.clean}` };
      if (flow.depth > 0 || flow.quote !== null) continue;
      yamlFlow(flow.text, found);
      flow = null;
      continue;
    }
    if (blockParent !== null) {
      if (!line.trim() || line.length - line.trimStart().length > blockParent) continue;
      blockParent = null;
    }
    const text = line.trim();
    if (!text || text.startsWith("#") || text === "---" || text === "...") continue;
    const prefix = /^(?:[ ]*-[ ]+)*[ ]*/.exec(line)[0];
    const column = prefix.length;
    const rest = line.slice(column).trimEnd();
    const wasExplicit = explicit;
    explicit = false;
    if (yamlExplicitKey.test(rest)) {
      explicit = true;
      continue;
    }
    const match = yamlKey.exec(rest);
    const explicitValue = wasExplicit ? yamlExplicitValue.exec(rest) : null;
    const isUses = Boolean(explicitValue)
      || (match !== null && ["uses", "\"uses\"", "'uses'"].includes(match[1]));
    const valueText = (explicitValue ? explicitValue[1] : match ? match[2] : rest) ?? "";
    const value = yamlValue(valueText);
    if (isUses && (!valueText.trim() || valueText.trim().startsWith("#"))) {
      const continuation = [];
      for (const next of lines.slice(index + 1)) {
        if (
          next.trim() && !next.trimStart().startsWith("#")
          && next.length - next.trimStart().length <= column
        ) break;
        continuation.push(next.replace(/\r+$/, ""));
      }
      found.push(["uses:", ...continuation].join("\n").trimEnd());
      blockParent = column;
      continue;
    }
    if (isUses) yamlEmit(value, valueText, found);
    if (value.type === "block") {
      const dash = prefix.lastIndexOf("-");
      blockParent = match || explicitValue || dash < 0 ? column : dash;
    } else if (value.type === "open-quote") quote = value.quote;
    else if (value.type === "flow") {
      const first = yamlFlowLine(value.text, 0, null);
      flow = { depth: first.depth, quote: first.quote, text: first.clean };
      if (flow.depth <= 0 && flow.quote === null) {
        yamlFlow(flow.text, found);
        flow = null;
      }
    }
  }
  if (flow !== null) yamlFlow(flow.text, found);
  return found;
}

/** Discover changed manifest declarations structurally; preserves workspace/section identity. Example: discoverManifest('package.json', {}, manifest). */
export function discoverManifest(path, before, after, resolved = {}) {
  return sections.flatMap((section) =>
    Object.entries(after[section] ?? {}).flatMap(([name, declaration]) => {
      if (before[section]?.[name] === declaration) return [];
      const row = {
        kind: "npm",
        path,
        section,
        name,
        declaration,
        previous: before[section]?.[name] ?? null,
      };
      row.id = identity(row);
      const alias = typeof declaration === "string"
        && /^npm:(.+)@([^@]+)$/.exec(declaration);
      row.package = alias ? alias[1] : name;
      row.alias = Boolean(alias);
      const spec = alias ? alias[2] : declaration;
      const exact = typeof spec === "string" && stable.test(spec);
      row.current = exact ? normalize(spec) : (resolved[row.id] ?? null);
      row.coverage = exact
        ? "exact"
        : typeof spec === "string" && /^[~^]\d+\.\d+\.\d+$/.test(spec)
        ? "range"
        : typeof spec === "string"
            && (/\d+\.\d+\.\d+-/.test(spec)
              || /^(latest|next|beta|alpha|canary|preview)$/.test(spec))
        ? "preview-or-tag"
        : "unsupported";
      if (row.current && !stable.test(row.current)) {
        row.coverage = "preview-or-tag";
        row.current = null;
      }
      if (
        row.current
        && row.coverage === "range"
        && !satisfiesRange(row.current, spec)
      ) {
        row.resolution_error = `Resolved version ${row.current} does not satisfy ${spec}`;
        row.current = null;
      }
      return [row];
    })
  );
}

/** Discover action declarations, including unsupported pins; uses the extractUses YAML subset. Example: discoverActions('ci.yml', oldText, newText). */
export function discoverActions(path, before, after) {
  const extract = (source) => extractUses(source || "");
  const old = extract(before);
  const declarations = extract(after);
  return declarations.flatMap((declaration, index) => {
    const previous = old.indexOf(declaration);
    if (previous >= 0) {
      old.splice(previous, 1);
      return [];
    }
    const match = /^([\w.-]+\/[\w.-]+)(?:\/[\w./-]+)?@(.+)$/.exec(declaration);
    const pin = match?.[2];
    // Without source locations, repeated declarations or ambiguous lines cannot supply evidence.
    const lines = after.split("\n").filter((text) => text.includes(declaration));
    const lineUses = lines.length === 1 ? extract(lines[0]) : [];
    const line = declarations.filter((value) => value === declaration).length === 1
        && lineUses.length === 1 && lineUses[0] === declaration
      ? lines[0]
      : null;
    const comment = line && /#\s*(v?\d+\.\d+\.\d+)\s*$/.exec(line)?.[1];
    const current = pin && stable.test(pin)
      ? pin
      : /^[a-f0-9]{40}$/i.test(pin ?? "")
      ? (comment ?? null)
      : null;
    return [
      {
        kind: "action",
        path,
        section: "uses",
        name: match?.[1] ?? declaration,
        declaration,
        id: `${path}#uses:${index}:${declaration}`,
        current,
        coverage: current ? "exact" : "unsupported",
        pin,
      },
    ];
  });
}

/** Read changes relative to the merge base without modifying the repository. Example: discoverChanges('origin/main', 'HEAD'). */
export function discoverChanges(
  base,
  head,
  resolved = {},
  runGit = (args) => execFileSync("git", args, { encoding: "utf8" }),
) {
  const git = (...args) => runGit(args);
  const baseTip = git("rev-parse", "--verify", "--end-of-options", `${base}^{commit}`).trim();
  const headTip = git("rev-parse", "--verify", "--end-of-options", `${head}^{commit}`).trim();
  const start = git("merge-base", baseTip, headTip).trim();
  const records = git(
    "diff",
    "--name-status",
    "--find-renames",
    "--find-copies",
    "--diff-filter=AMRC",
    "-z",
    start,
    headTip,
  ).split("\0").filter(Boolean);
  const changes = [];
  for (let index = 0; index < records.length;) {
    const status = records[index++];
    const firstPath = records[index++];
    const path = /^[RC]/.test(status) ? records[index++] : firstPath;
    changes.push({ path, oldPath: status.startsWith("R") ? firstPath : path });
  }
  const read = (ref, path, optional = false) => {
    const result = spawnSync("git", ["show", `${ref}:${path}`], {
      encoding: "utf8",
    });
    if (result.status === 0) return result.stdout;
    if (optional && !git("ls-tree", ref, "--", path).trim()) return "";
    throw new Error(`git show ${ref}:${path}: ${result.stderr}`);
  };
  const rows = [];
  const uncovered = [];
  for (const { path, oldPath } of changes) {
    if (/(^|\/)package\.json$/.test(path)) {
      rows.push(
        ...discoverManifest(
          path,
          JSON.parse(read(start, oldPath, true) || "{}"),
          JSON.parse(read(headTip, path)),
          resolved,
        ),
      );
    } else if (/\.ya?ml$/.test(path)) {
      rows.push(
        ...discoverActions(path, read(start, oldPath, true), read(headTip, path)),
      );
    } else if (
      /(^|\/)(Cargo\.(toml|lock)|Dockerfile[^/]*|requirements[^/]*\.txt|pyproject\.toml|go\.(mod|sum))$/
        .test(
          path,
        )
    ) {
      uncovered.push({ path, coverage: "unsupported-ecosystem" });
    }
  }
  return { base: start, base_tip: baseTip, head: headTip, rows, uncovered };
}

/** Fetch registry/GitHub evidence; 404 is distinct from operational failure. Example: createEvidence().npm('typescript'). */
export function createEvidence({ fetcher = fetch, run = spawnSync } = {}) {
  const request = async (url) => {
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(30000),
      });
      if (response.status === 404) return { status: "not_found" };
      if (!response.ok) {
        return { status: "error", reason: `HTTP ${response.status}` };
      }
      return { status: "ok", data: await response.json() };
    } catch (error) {
      return { status: "error", reason: error.message };
    }
  };
  const github = async (endpoint) => {
    const result = run("gh", ["api", "--include", endpoint], {
      encoding: "utf8",
    });
    const output = (result.stdout ?? "").replaceAll("\r\n", "\n");
    const http = /^HTTP\/\S+ (\d+)/m.exec(output)?.[1];
    if (http === "404") return { status: "not_found" };
    if (result.status !== 0) {
      return {
        status: "error",
        reason: result.error?.message
          ?? result.stderr?.trim()
          ?? `exit ${result.status}`,
      };
    }
    try {
      return {
        status: "ok",
        data: JSON.parse(output.slice(output.indexOf("\n\n") + 2)),
      };
    } catch (error) {
      return {
        status: "error",
        reason: `Invalid GitHub JSON: ${error.message}`,
      };
    }
  };
  return {
    npm: (name) => request(`https://registry.npmjs.org/${encodeURIComponent(name)}`),
    github,
  };
}

const repoOf = (metadata) =>
  /github\.com[/:]([^/]+\/[^/#]+?)(?:\.git)?(?:[#/]|$)/.exec(
    typeof metadata.repository === "string"
      ? metadata.repository
      : (metadata.repository?.url ?? ""),
  )?.[1];
const unknown = (reason) => ({ status: "unknown", reason });
const releaseCheck = (release, published, cutoff) => {
  if (
    !release
    || typeof release !== "object"
    || typeof release.draft !== "boolean"
    || typeof release.prerelease !== "boolean"
  ) {
    return unknown("Missing release flags");
  }
  if (release.draft || release.prerelease) {
    return {
      status: "ineligible",
      reason: "Draft or prerelease GitHub release",
    };
  }
  const time = Date.parse(published);
  const releaseTime = Date.parse(release.published_at);
  if (!Number.isFinite(time) || !Number.isFinite(releaseTime)) {
    return unknown("Missing or invalid publication time");
  }
  if (time > cutoff || releaseTime > cutoff) {
    return {
      status: "ineligible",
      reason: "Publication younger than cutoff",
      published,
      release_published: release.published_at,
    };
  }
  return {
    status: "eligible",
    published,
    release_published: release.published_at,
    tag: release.tag_name,
  };
};

async function npmRelease(evidence, repo, name, version) {
  if (!repo) return unknown("No GitHub repository metadata");
  const short = name.split("/").at(-1);
  for (
    const tag of new Set([
      `v${version}`,
      version,
      `${name}@${version}`,
      `${short}@${version}`,
      `${short}-v${version}`,
    ])
  ) {
    const result = await evidence.github(
      `repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    );
    if (result.status === "error") return unknown(result.reason);
    if (result.status === "ok") return { status: "ok", release: result.data };
  }
  return {
    status: "ineligible",
    reason: "No GitHub release (all supported tag patterns returned 404)",
  };
}

/** Assess current and candidate versions with injected I/O and clock. Example: await assess(row, fakeEvidence, Date.now() - 3 * 86400000). */
export async function assess(row, evidence, cutoff) {
  const result = {
    ...row,
    current_evidence: unknown("No exact stable version to assess"),
    candidates: [],
    completeness: "unknown",
    recommendation: "unknown",
  };
  if (!row.current || !["exact", "range"].includes(row.coverage)) {
    if (row.resolution_error) {
      result.current_evidence = unknown(row.resolution_error);
    }
    return result;
  }
  if (row.kind === "npm") {
    const metadata = await evidence.npm(row.package);
    if (metadata.status !== "ok") {
      result.current_evidence = unknown(
        metadata.status === "not_found"
          ? "Registry package not found"
          : metadata.reason,
      );
      return result;
    }
    const data = metadata.data;
    if (!data.versions || typeof data.versions !== "object") {
      result.current_evidence = unknown("Missing registry versions");
      return result;
    }
    const versions = Object.keys(data.versions)
      .filter((v) => stable.test(v) && compare(v, row.current) > 0)
      .sort((a, b) => compare(b, a));
    result.preview_versions = Object.keys(data.versions).filter((v) => /\d+\.\d+\.\d+-/.test(v));
    const check = async (version) => {
      if (!Object.hasOwn(data.versions, normalize(version))) {
        return unknown("Exact version absent from registry versions");
      }
      const release = await npmRelease(
        evidence,
        repoOf(data),
        row.package,
        normalize(version),
      );
      return release.status === "ok"
        ? releaseCheck(release.release, data.time?.[normalize(version)], cutoff)
        : release;
    };
    result.current_evidence = await check(row.current);
    result.newer_stable_count = versions.length;
    for (const version of versions) {
      const candidate = { version, ...(await check(version)) };
      result.candidates.push(candidate);
      if (candidate.status === "eligible") break;
    }
  } else {
    const releases = [];
    for (let page = 1;; page++) {
      const response = await evidence.github(
        `repos/${row.name}/releases?per_page=100&page=${page}`,
      );
      if (response.status !== "ok" || !Array.isArray(response.data)) {
        result.current_evidence = unknown(
          response.reason ?? "Incomplete Actions release listing",
        );
        return result;
      }
      releases.push(...response.data);
      if (response.data.length < 100) break;
    }
    if (/^[a-f0-9]{40}$/i.test(row.pin ?? "")) {
      const ref = await evidence.github(
        `repos/${row.name}/commits/${encodeURIComponent(row.current)}`,
      );
      if (ref.status !== "ok" || ref.data.sha !== row.pin) {
        result.current_evidence = unknown(
          ref.reason ?? "Pinned SHA does not match version tag",
        );
        return result;
      }
    }
    const current = releases.find(
      (release) =>
        stable.test(release.tag_name ?? "")
        && release.tag_name === row.current,
    );
    result.current_evidence = releaseCheck(
      current,
      current?.published_at,
      cutoff,
    );
    const newer = releases
      .filter(
        (release) =>
          stable.test(release.tag_name ?? "")
          && key(release.tag_name)[0] === key(row.current)[0]
          && compare(release.tag_name, row.current) > 0,
      )
      .sort((a, b) => compare(b.tag_name, a.tag_name));
    for (const release of newer) {
      result.candidates.push({
        version: release.tag_name,
        ...releaseCheck(release, release.published_at, cutoff),
      });
    }
  }
  const eligible = result.candidates.find(
    (candidate) => candidate.status === "eligible",
  );
  const higherUnknown = result.candidates.some(
    (candidate) =>
      candidate.status === "unknown"
      && (!eligible || compare(candidate.version, eligible.version) > 0),
  );
  result.completeness = result.current_evidence.status === "unknown"
      || result.candidates.some((candidate) => candidate.status === "unknown")
    ? "unknown"
    : "complete";
  result.eligible = eligible?.version ?? null;
  result.recommendation = higherUnknown
    ? "unknown"
    : eligible
    ? "eligible-newer-version"
    : result.candidates.length
    ? "no-eligible-newer-version"
    : "no-newer-stable-version";
  return result;
}

/** CLI accepts only explicit options; JSON includes coverage and evidence. Example: await main(['--json']). */
export async function main(args) {
  const options = { base: "origin/main", head: "HEAD", "min-days": "3" };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--json") options.json = true;
    else if (
      ["--base", "--head", "--min-days", "--resolved"].includes(flag)
      && args[index + 1]
      && !args[index + 1].startsWith("--")
    ) {
      options[flag.slice(2)] = args[++index];
    } else {
      throw new Error(
        `Invalid argument ${flag}; expected --base REF, --head REF, --min-days NUMBER, --resolved FILE, or --json`,
      );
    }
  }
  const days = Number(options["min-days"]);
  if (!Number.isFinite(days) || days < 0) {
    throw new Error(
      `Invalid min-days ${options["min-days"]}; expected finite nonnegative number`,
    );
  }
  const resolved = options.resolved
    ? JSON.parse(readFileSync(options.resolved, "utf8"))
    : {};
  if (
    !resolved
    || typeof resolved !== "object"
    || Array.isArray(resolved)
    || Object.values(resolved).some((value) => typeof value !== "string")
  ) {
    throw new Error(
      "Invalid resolved mapping; expected object of declaration IDs to exact version strings",
    );
  }
  const inventory = discoverChanges(options.base, options.head, resolved);
  const cutoff = Date.now() - days * 86400000;
  const evidence = createEvidence();
  const rows = [];
  for (const row of inventory.rows) {
    rows.push(await assess(row, evidence, cutoff));
  }
  const report = { ...inventory, cutoff: new Date(cutoff).toISOString(), rows };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Cutoff: ${report.cutoff}`);
    for (const row of rows) {
      console.log(
        `${row.id}: ${row.declaration}; current=${
          row.current ?? "unresolved"
        } (${row.current_evidence.status}); ${row.recommendation}${
          row.eligible ? ` ${row.eligible}` : ""
        }; coverage=${row.coverage}; completeness=${row.completeness}`,
      );
    }
    for (const row of inventory.uncovered) {
      console.log(`${row.path}: ${row.coverage}`);
    }
  }
  return rows.some(
      (row) =>
        row.completeness === "unknown"
        || row.current_evidence.status !== "eligible",
    ) || inventory.uncovered.length
    ? 2
    : 0;
}
/** True when this module is the process entrypoint, including via a symlinked path. Example: if (isEntrypoint()) main(). */
function isEntrypoint() {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}
if (process.argv[1] && isEntrypoint()) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
