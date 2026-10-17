#!/usr/bin/env bun
/** Build and validate installable skill packages. Example: bun scripts/package-skills.mjs --version 1.2.3 */
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateSkills } from "./validate-skills.mjs";
import { readZip, writeZip } from "./zip-archive.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const BUNDLE = "mango-skills";
export const PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const REPOSITORY = "https://github.com/juliopolycarpo/mango-skills";
const AUTHOR = "Julio Polycarpo";
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-z-][0-9a-z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-z-][0-9a-z-]*))*))?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/i;
// Intersection of the Agent Plugins name rule and the OpenAI upload rule (no dots).
const PLUGIN_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const BUNDLE_ICON = "assets/mango-skills.svg";
// OpenAI upload limits for one archive.
const MAX_ENTRIES = 5000;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
// Archive names this packager owns in an output directory, across versions.
const PACKAGE_ARCHIVE = /^mango-.+\.zip$/;
const IGNORED = new Set(["node_modules", ".git", "__pycache__", ".DS_Store"]);
const SHARED_FIELDS = [
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
];
const describe = (value) => value === undefined ? "missing" : JSON.stringify(value);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const nonblank = (value) => typeof value === "string" && value.trim() !== "";

function frontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  return match ? Bun.YAML.parse(match[1]) : null;
}

function skillFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED.has(entry.name) || entry.name.endsWith(".pyc")) return [];
    const path = join(directory, entry.name);
    const local = prefix + entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(`(${local}): expected regular file or directory | received: symlink`);
    }
    if (entry.isDirectory()) return skillFiles(path, `${local}/`);
    const data = readFileSync(path);
    // Executable intent comes from the shebang so checkouts without mode bits build identically.
    return [{ path: local, data, mode: data.subarray(0, 2).toString() === "#!" ? 0o755 : 0o644 }];
  });
}

/**
 * Read every distributed skill under ROOT with its files and listing metadata, sorted by name.
 * Example: collectSkills(".").map((skill) => skill.name)
 */
export function collectSkills(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const directory = join(root, name);
      const meta = frontmatter(readFileSync(join(directory, "SKILL.md"), "utf8")) ?? {};
      const metadataPath = join(directory, "agents/openai.yaml");
      const display = existsSync(metadataPath)
        ? Bun.YAML.parse(readFileSync(metadataPath, "utf8"))?.interface ?? {}
        : {};
      return {
        name,
        description: meta.description,
        displayName: display.display_name ?? name,
        summary: display.short_description ?? meta.description,
        icon: typeof display.icon_large === "string"
          ? display.icon_large.replace(/^\.\//, "")
          : null,
        files: skillFiles(directory),
      };
    });
}

function manifests({ name, version, description, keywords, interface: listing }) {
  const shared = {
    name,
    version,
    description,
    author: { name: AUTHOR, url: "https://github.com/juliopolycarpo" },
    homepage: REPOSITORY,
    repository: REPOSITORY,
    license: "MIT",
    keywords,
  };
  return {
    // Agent Plugins 1.0 manifest read by ChatGPT and current Codex clients.
    "plugin.json": {
      $schema: PLUGIN_SCHEMA,
      ...shared,
      extensions: { "com.openai": { interface: listing } },
    },
    // Compatibility overlay for Codex clients that only read the legacy location.
    ".codex-plugin/plugin.json": { ...shared, skills: "./skills/", interface: listing },
  };
}

function listing(fields) {
  return {
    developerName: AUTHOR,
    category: "Developer Tools",
    capabilities: ["Interactive", "Write"],
    websiteURL: REPOSITORY,
    ...fields,
  };
}

function pluginFiles(root, plugin, skills, extra = []) {
  const files = Object.entries(manifests(plugin)).map(([path, value]) => ({
    path: `${plugin.name}/${path}`,
    data: `${JSON.stringify(value, null, 2)}\n`,
  }));
  for (const path of ["LICENSE", ...extra]) {
    files.push({ path: `${plugin.name}/${path}`, data: readFileSync(join(root, path)) });
  }
  for (const skill of skills) {
    for (const file of skill.files) {
      files.push({ ...file, path: `${plugin.name}/skills/${skill.name}/${file.path}` });
    }
  }
  return files;
}

/**
 * Describe every artifact for one version without writing it: the bundle plugin and one plugin
 * per skill.
 * Example: plannedPackages(".", "1.2.3").map((artifact) => artifact.file)
 */
export function plannedPackages(root, version) {
  if (!SEMVER.test(version)) {
    throw new Error(
      `(--version): expected strict SemVer such as 1.2.3 | received: ${describe(version)}`,
    );
  }
  const skills = collectSkills(root);
  if (!skills.length) {
    throw new Error(`(${root}): expected at least one skill directory | received: none`);
  }
  const bundle = {
    kind: "bundle",
    name: BUNDLE,
    file: `${BUNDLE}-${version}.zip`,
    skills: skills.map((skill) => skill.name),
    files: pluginFiles(
      root,
      {
        name: BUNDLE,
        version,
        description:
          "Standalone agent skills for reviewing, testing, upgrading, and shipping software.",
        keywords: ["skills", "git", "github", "pull requests", "releases", "testing"],
        interface: listing({
          displayName: "Mango Skills",
          shortDescription: "Software delivery skills",
          longDescription:
            "Agent skills for software maintenance and delivery: follow CI and review feedback, write Conventional Commits, rebase, squash or merge PRs, roll up dependency updates, prove regressions, qualify performance, and edit prose. Skills follow the consuming repository's policies and never treat invocation as permission to publish, merge, or rewrite history.",
          defaultPrompt: [
            "Get this PR to merge readiness",
            "Draft a commit message for my staged changes",
            "Prove this regression test fails before the fix",
          ],
          logo: `./${BUNDLE_ICON}`,
          composerIcon: `./${BUNDLE_ICON}`,
        }),
      },
      skills,
      [BUNDLE_ICON],
    ),
  };
  const plugins = skills.map((skill) => {
    const name = `mango-${skill.name}`;
    return {
      kind: "plugin",
      name,
      file: `${name}-${version}.zip`,
      skills: [skill.name],
      files: pluginFiles(root, {
        name,
        version,
        description: skill.summary,
        keywords: ["skills", skill.name],
        interface: listing({
          displayName: skill.displayName,
          longDescription: skill.description,
          ...(skill.icon
            ? {
              logo: `./skills/${skill.name}/${skill.icon}`,
              composerIcon: `./skills/${skill.name}/${skill.icon}`,
            }
            : {}),
        }),
      }, [skill]),
    };
  });
  return [bundle, ...plugins];
}

/**
 * Write every planned archive and a SHA256SUMS file into OUT, replacing earlier ZIPs there.
 * Example: buildPackages({ root: ".", version: "1.2.3", out: "dist" })
 */
export function buildPackages({ root, version, out }) {
  const artifacts = plannedPackages(root, version);
  mkdirSync(out, { recursive: true });
  for (const entry of readdirSync(out)) {
    if (PACKAGE_ARCHIVE.test(entry) || entry === "SHA256SUMS") rmSync(join(out, entry));
  }
  const sums = [];
  for (const artifact of artifacts) {
    const data = writeZip(artifact.files);
    writeFileSync(join(out, artifact.file), data);
    artifact.sha256 = sha256(data);
    sums.push(`${artifact.sha256}  ${artifact.file}\n`);
  }
  writeFileSync(join(out, "SHA256SUMS"), sums.join(""));
  return artifacts.map(({ kind, name, file, skills, sha256 }) => ({
    kind,
    name,
    file,
    skills,
    sha256,
  }));
}

function checkString(manifest, field, fail, limit) {
  const value = manifest[field];
  if (value === undefined) return;
  if (!nonblank(value) || (limit && value.length > limit)) {
    fail(
      `${field}: ${describe(value)}`,
      `nonblank string${limit ? ` of at most ${limit} characters` : ""}`,
    );
  }
}

/**
 * Check a portable plugin manifest against the Agent Plugins 1.0 and OpenAI listing rules,
 * resolving referenced assets through HAS_FILE. Returns error strings.
 * Example: manifestErrors(JSON.parse(text), { name: "mango-skills", version: "1.2.3", hasFile })
 */
export function manifestErrors(manifest, { name, version, hasFile }) {
  const errors = [];
  const fail = (received, expected) =>
    errors.push(`plugin.json: expected ${expected}; received ${received}`);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail(describe(manifest), "JSON object");
    return errors;
  }
  if (manifest.$schema !== PLUGIN_SCHEMA) {
    fail(describe(manifest.$schema), `$schema ${PLUGIN_SCHEMA}`);
  }
  if (
    manifest.name !== name || !PLUGIN_NAME.test(name) || /--|\.\./.test(name)
  ) fail(describe(manifest.name), `name ${name} (lowercase letters, digits, hyphens)`);
  if (manifest.version !== version || !SEMVER.test(manifest.version ?? "")) {
    fail(describe(manifest.version), `strict SemVer version ${version}`);
  }
  checkString(manifest, "description", fail, 1024);
  for (const field of ["homepage", "repository", "license"]) checkString(manifest, field, fail);
  const author = manifest.author;
  if (
    author !== undefined
    && (!author || typeof author !== "object" || !nonblank(author.name)
      || Object.keys(author).some((key) => !["name", "email", "url"].includes(key)))
  ) {
    fail(
      `author: ${describe(author)}`,
      "author object with nonblank name and only name, email, url",
    );
  }
  if (
    manifest.keywords !== undefined
    && (!Array.isArray(manifest.keywords) || !manifest.keywords.every(nonblank))
  ) fail(`keywords: ${describe(manifest.keywords)}`, "array of nonblank strings");
  for (const field of ["skills", "mcpServers", "apps", "interface"]) {
    if (field in manifest) fail(field, `no top-level ${field} in the portable manifest`);
  }
  const openai = manifest.extensions?.["com.openai"];
  if (!openai || typeof openai !== "object" || Array.isArray(openai)) {
    fail(`extensions: ${describe(manifest.extensions)}`, "extensions.com.openai object");
    return errors;
  }
  if (openai.apps != null) {
    fail(`apps: ${describe(openai.apps)}`, "no app declarations in a skills-only plugin");
  }
  const listing = openai.interface ?? {};
  const listingFail = (received, expected) => fail(received, `interface ${expected}`);
  checkString(listing, "displayName", listingFail, 30);
  checkString(listing, "shortDescription", listingFail, 30);
  checkString(listing, "longDescription", listingFail, 4000);
  checkString(listing, "developerName", listingFail, 80);
  checkString(listing, "category", listingFail);
  if (!nonblank(listing.displayName)) listingFail(describe(listing.displayName), "displayName");
  if (
    listing.capabilities !== undefined
    && !(Array.isArray(listing.capabilities) && listing.capabilities.every(nonblank))
  ) {
    listingFail(
      `capabilities: ${describe(listing.capabilities)}`,
      "capabilities array of nonblank strings",
    );
  }
  const prompts = listing.defaultPrompt === undefined
    ? []
    : Array.isArray(listing.defaultPrompt)
    ? listing.defaultPrompt
    : [listing.defaultPrompt];
  if (
    prompts.length > 3
    || prompts.some((prompt) => !nonblank(prompt) || prompt.length > 128 || /[\r\n]/.test(prompt))
  ) {
    listingFail(
      `defaultPrompt: ${describe(listing.defaultPrompt)}`,
      "defaultPrompt of up to three single-line strings of at most 128 characters",
    );
  }
  for (const field of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
    const value = listing[field];
    if (value !== undefined && !/^https:\/\/[^\s@/]+(?:\/\S*)?$/.test(value)) {
      listingFail(`${field}: ${describe(value)}`, `${field} absolute HTTPS URL`);
    }
  }
  for (const field of ["brandColor", "brandColorDark"]) {
    if (listing[field] !== undefined && !/^#[0-9a-f]{6}$/i.test(listing[field])) {
      listingFail(`${field}: ${describe(listing[field])}`, `${field} #RRGGBB color`);
    }
  }
  for (const field of ["logo", "logoDark", "composerIcon", "composerIconDark"]) {
    const value = listing[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value.startsWith("./") || !hasFile(value.slice(2))) {
      // Clients resolve icon paths from the plugin root; only packaged files can render.
      listingFail(`${field}: ${describe(value)}`, `${field} contained ./ path to a packaged file`);
    }
  }
  return errors;
}

function overlayErrors(overlay, manifest) {
  const errors = [];
  const fail = (received, expected) =>
    errors.push(`.codex-plugin/plugin.json: expected ${expected}; received ${received}`);
  if (!overlay || typeof overlay !== "object") {
    fail(describe(overlay), "JSON object");
    return errors;
  }
  for (const field of SHARED_FIELDS) {
    if (JSON.stringify(overlay[field]) !== JSON.stringify(manifest[field])) {
      fail(
        `${field}: ${describe(overlay[field])}`,
        `${field} matching plugin.json ${describe(manifest[field])}`,
      );
    }
  }
  const listing = manifest.extensions?.["com.openai"]?.interface;
  if (JSON.stringify(overlay.interface) !== JSON.stringify(listing)) {
    fail(
      `interface: ${describe(overlay.interface)}`,
      "interface matching plugin.json extensions.com.openai.interface",
    );
  }
  const extra = Object.keys(overlay).filter((key) =>
    !SHARED_FIELDS.includes(key) && key !== "skills" && key !== "interface"
  );
  for (const key of extra) fail(key, "only plugin.json fields, skills and interface");
  if (overlay.skills !== "./skills/") {
    fail(`skills: ${describe(overlay.skills)}`, `skills "./skills/"`);
  }
  return errors;
}

function extract(files) {
  const directory = mkdtempSync(join(tmpdir(), "mango-package-"));
  for (const [path, data] of files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), data);
  }
  return directory;
}

/**
 * Validate one built archive from its bytes: safe single-root layout, manifests, skill set and
 * bytes matching the source, and skill structure after extraction. Returns error strings.
 * Example: archiveErrors(readFileSync("dist/mango-skills-1.2.3.zip"), artifact, ".", "1.2.3")
 */
export function archiveErrors(data, artifact, root, version) {
  let entries;
  try {
    entries = readZip(data);
  } catch (error) {
    return [error.message];
  }
  const errors = [];
  const fail = (received, expected) => errors.push(`expected ${expected}; received ${received}`);
  const prefix = `${artifact.name}/`;
  const files = new Map();
  for (const entry of entries) {
    if (entry.type === "symlink") fail(entry.path, "no symlink entries");
    if (!entry.path.startsWith(prefix)) fail(entry.path, `every entry inside ${prefix}`);
    else if (entry.type === "file") files.set(entry.path.slice(prefix.length), entry.data);
  }
  if (entries.length > MAX_ENTRIES) {
    fail(`${entries.length} entries`, `at most ${MAX_ENTRIES} entries`);
  }
  if (data.length > MAX_ARCHIVE_BYTES) {
    fail(`${data.length} bytes`, `at most ${MAX_ARCHIVE_BYTES} bytes`);
  }
  const folded = new Map();
  for (const entry of entries) {
    const key = entry.path.normalize("NFC").toLowerCase();
    if (folded.has(key)) {
      fail(`${folded.get(key)} and ${entry.path}`, "paths unique after case folding");
    }
    folded.set(key, entry.path);
  }
  if (errors.length) return errors;
  const skillRoot = "skills/";
  const sources = new Map(collectSkills(root).map((skill) => [skill.name, skill]));
  const packaged = new Set();
  for (const path of files.keys()) {
    if (!path.startsWith(skillRoot)) {
      const allowed = ["plugin.json", ".codex-plugin/plugin.json", "LICENSE"];
      if (artifact.kind === "bundle") allowed.push(BUNDLE_ICON);
      if (!allowed.includes(path)) {
        fail(path, "only skill content, manifests and LICENSE");
      }
      continue;
    }
    packaged.add(path.slice(skillRoot.length).split("/")[0]);
  }
  if (JSON.stringify([...packaged].sort()) !== JSON.stringify([...artifact.skills].sort())) {
    fail(describe([...packaged].sort()), `skills ${describe(artifact.skills)}`);
  }
  for (const name of artifact.skills) {
    const base = `${skillRoot}${name}/`;
    const expected = new Map(
      (sources.get(name)?.files ?? []).map((file) => [base + file.path, file.data]),
    );
    const received = [...files.keys()].filter((path) => path.startsWith(base));
    for (const path of new Set([...expected.keys(), ...received])) {
      if (!files.has(path)) fail(`missing ${path}`, "every source skill file packaged");
      else if (!expected.has(path)) fail(`extra ${path}`, "only source skill files");
      else if (!files.get(path).equals(expected.get(path))) {
        fail(path, "packaged bytes matching the source");
      }
    }
    const skill = files.get(`${base}SKILL.md`);
    const description = skill ? frontmatter(skill.toString("utf8"))?.description : undefined;
    if (typeof description === "string" && description.length > 1024) {
      fail(
        `${base}SKILL.md description of ${description.length} characters`,
        "description of at most 1024 characters",
      );
    }
    if (`${artifact.name}:${name}`.length > 64) {
      fail(`${artifact.name}:${name}`, "plugin:skill identity of at most 64 characters");
    }
    if (skill && skill.length > 1024 * 1024) {
      fail(`${base}SKILL.md ${skill.length} bytes`, "SKILL.md of at most 1 MiB");
    }
    try {
      if (skill) new TextDecoder("utf-8", { fatal: true }).decode(skill);
    } catch {
      fail(`${base}SKILL.md`, "UTF-8 SKILL.md");
    }
  }
  try {
    const manifest = JSON.parse(files.get("plugin.json") ?? "null");
    errors.push(
      ...manifestErrors(manifest, {
        name: artifact.name,
        version,
        hasFile: (path) => files.has(path),
      }),
    );
    errors.push(
      ...overlayErrors(
        JSON.parse(files.get(".codex-plugin/plugin.json") ?? "null"),
        manifest ?? {},
      ),
    );
  } catch (error) {
    fail(error.message, "parseable plugin.json and .codex-plugin/plugin.json");
  }
  const directory = extract(
    [...files].filter(([path]) => path.startsWith(skillRoot)).map(([path, value]) => [
      path.slice(skillRoot.length),
      value,
    ]),
  );
  try {
    const report = validateSkills(directory);
    errors.push(...report.errors.map((error) => error.replaceAll(directory, "<archive>")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return errors;
}

/**
 * Validate every archive and the checksum file in OUT against the planned artifacts.
 * Returns errors prefixed by archive name.
 * Example: validatePackages({ root: ".", version: "1.2.3", out: "dist" })
 */
export function validatePackages({ root, version, out }) {
  const errors = [];
  const artifacts = plannedPackages(root, version);
  const sums = existsSync(join(out, "SHA256SUMS"))
    ? readFileSync(join(out, "SHA256SUMS"), "utf8")
    : "";
  const listed = new Map(
    sums.trim().split("\n").filter(Boolean).map((line) => line.split(/ {2}/).reverse()),
  );
  const archives = readdirSync(out).filter((entry) => PACKAGE_ARCHIVE.test(entry)).sort();
  const expected = artifacts.map((artifact) => artifact.file).sort();
  if (JSON.stringify(archives) !== JSON.stringify(expected)) {
    errors.push(`${out}: expected archives ${describe(expected)}; received ${describe(archives)}`);
  }
  for (const artifact of artifacts) {
    const path = join(out, artifact.file);
    if (!existsSync(path) || !lstatSync(path).isFile()) continue;
    const data = readFileSync(path);
    if (listed.get(artifact.file) !== sha256(data)) {
      errors.push(
        `SHA256SUMS: expected ${artifact.file} ${sha256(data)}; received ${
          describe(listed.get(artifact.file))
        }`,
      );
    }
    errors.push(
      ...archiveErrors(data, artifact, root, version).map((error) => `${artifact.file}: ${error}`),
    );
  }
  return errors;
}

/** Build then validate packages; returns the process exit code. Example: main(["--version", "1.2.3"]) */
export function main(args = []) {
  const options = { root: resolve(here, ".."), version: "0.0.0", out: null };
  for (let index = 0; index < args.length; index += 2) {
    const key = { "--version": "version", "--out": "out", "--root": "root" }[args[index]];
    if (!key || args[index + 1] === undefined) {
      throw new Error(
        `Invalid arguments ${
          JSON.stringify(args)
        }; expected [--version SEMVER] [--out DIR] [--root DIR]`,
      );
    }
    options[key] = args[index + 1];
  }
  options.out = resolve(options.out ?? join(options.root, "dist"));
  const built = buildPackages(options);
  const errors = validatePackages(options);
  for (const error of errors) console.error(error);
  for (const artifact of built) {
    console.log(`${artifact.sha256}  ${relative(process.cwd(), join(options.out, artifact.file))}`);
  }
  console.log(`${built.length} archives, ${errors.length} errors`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
