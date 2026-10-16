#!/usr/bin/env bun
/** Validate maintained skill structure. Example: bun scripts/validate-skills.mjs --json */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sax from "sax";

const here = dirname(fileURLToPath(import.meta.url));
const describe = (value) => value === undefined ? "missing" : JSON.stringify(value);
const normalizeLabel = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();
const textOf = (path) => readFileSync(path, "utf8");
function inside(directory, path) {
  const local = relative(directory, path);
  return local.split(/[\\/]/)[0] !== ".." && !isAbsolute(local);
}
function physicallyInside(directory, path) {
  return inside(directory, path) && inside(realpathSync(directory), realpathSync(path));
}
function markdownFiles(directory, skillDirectory, failAt, ancestors = new Set()) {
  const physical = realpathSync(directory);
  if (ancestors.has(physical)) return [];
  const visited = new Set([...ancestors, physical]);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".git") return [];
    const path = resolve(directory, entry.name);
    if (!existsSync(path)) return [];
    const info = entry.isSymbolicLink() ? statSync(path) : entry;
    if (info.isDirectory()) {
      if (!physicallyInside(skillDirectory, path)) {
        failAt(path)(relative(skillDirectory, path), "local resource inside the skill directory");
        return [];
      }
      return markdownFiles(path, skillDirectory, failAt, visited);
    }
    return info.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}
function withoutCode(source) {
  const lines = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").split(/\r?\n/);
  let fence;
  return lines.map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (!fence && marker) {
      fence = marker;
      return "";
    }
    if (!fence) return line;
    if (
      marker?.[0] === fence[0] && marker.length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)
    ) fence = null;
    return "";
  }).join("\n");
}
function headingAnchors(source) {
  const anchors = new Set();
  const counts = new Map();
  const lines = withoutCode(source).split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    for (const match of line.matchAll(/<(?:a|h[1-6])\b[^>]*\b(?:id|name)=["']([^"']+)["']/gi)) {
      anchors.add(match[1]);
    }
    const heading = /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+\s*)?$/.exec(line)?.[1]
      ?? (/^ {0,3}(?:=+|-+)\s*$/.test(line) && index > 0 ? lines[index - 1].trim() : null);
    if (!heading) continue;
    const slug = heading.replace(/!?(\[([^\]]+)\])\([^)]*\)/g, "$2").replace(/<[^>]*>/g, "")
      .toLowerCase().replace(/[^\p{L}\p{N}\p{M}_ -]/gu, "").replace(/ /g, "-");
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    anchors.add(count ? `${slug}-${count}` : slug);
  }
  return anchors;
}
function markdownLinks(source, fail) {
  const definitions = new Map();
  let text = withoutCode(source).replace(
    /^ {0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)(?:\s+.*)?$/gm,
    (_, label, destination) => {
      definitions.set(normalizeLabel(label), destination.replace(/^<|>$/g, ""));
      return "";
    },
  );
  text = text.replace(/(`+)([\s\S]*?)\1/g, "");
  const links = [...definitions.values()];
  // Read balanced destination parentheses so links to paths containing parentheses work.
  const start = /!?\[([^\]\n]+)\](\(|\[([^\]\n]*)\])?/g;
  for (const match of text.matchAll(start)) {
    if (match[2] === "(") {
      const offset = match.index + match[0].length;
      let depth = 1, end = offset;
      for (; end < text.length && depth; end++) {
        if (text[end] === "\\") {
          end++;
          continue;
        }
        if (text[end] === "(") depth++;
        if (text[end] === ")") depth--;
      }
      if (depth) {
        fail(match[0], "closed Markdown link destination");
        continue;
      }
      const destination = text.slice(offset, end - 1).trim();
      links.push(
        destination.startsWith("<")
          ? destination.slice(1, destination.indexOf(">"))
          : destination.replace(/\s+["'].*$/, ""),
      );
      continue;
    }
    const label = normalizeLabel(match[3] || match[1]);
    if (definitions.has(label)) links.push(definitions.get(label));
    else if (match[2]?.startsWith("[")) fail(label, "defined Markdown reference label");
  }
  return links;
}
function checkMarkdown(path, directory, fail) {
  if (!physicallyInside(directory, path)) {
    fail(
      relative(directory, path).replaceAll("\\", "/"),
      "local resource inside the skill directory",
    );
    return;
  }
  const source = textOf(path);
  for (const link of markdownLinks(source, fail)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link)) continue;
    let destination, anchor;
    try {
      const [rawPath, rawAnchor] = link.split("#", 2);
      destination = rawPath
        ? resolve(
          dirname(path),
          decodeURIComponent(rawPath.split("?")[0]).replace(/\\([() ])/g, "$1"),
        )
        : path;
      anchor = rawAnchor === undefined ? null : decodeURIComponent(rawAnchor);
    } catch {
      fail(link, "valid URL-encoded local Markdown destination");
      continue;
    }
    if (
      !inside(directory, destination)
      || (existsSync(destination) && !physicallyInside(directory, destination))
    ) {
      fail(link, "local target inside the skill directory");
      continue;
    }
    if (!existsSync(destination)) {
      fail(link, `existing local target (${destination})`);
      continue;
    }
    if (anchor && /\.md$/i.test(destination) && !headingAnchors(textOf(destination)).has(anchor)) {
      fail(link, `existing heading anchor in ${destination}`);
    }
  }
}
function checkSvg(path, fail) {
  let root, depth = 0, titleDepth = 0, title = "";
  const parser = sax.parser(true);
  parser.ondoctype = () => {
    throw new Error("DOCTYPE is unsupported for skill assets");
  };
  parser.onopentag = (tag) => {
    depth++;
    if (!root) root = tag;
    else if (depth === 1) throw new Error("Multiple XML root elements");
    if (tag.name === "title") titleDepth = depth;
  };
  parser.ontext = (text) => {
    if (titleDepth) title += text;
  };
  parser.oncdata = parser.ontext;
  parser.onclosetag = () => {
    if (depth === titleDepth) titleDepth = 0;
    depth--;
  };
  try {
    parser.write(textOf(path)).close();
  } catch (error) {
    fail(error.message, "well-formed SVG XML");
    return;
  }
  if (root?.name !== "svg" || root.attributes.xmlns !== "http://www.w3.org/2000/svg") {
    fail(root?.name, "svg root with http://www.w3.org/2000/svg namespace");
    return;
  }
  if (!title.trim()) fail(title, "nonempty SVG title");
  const { width, height, viewBox } = root.attributes;
  const positive = (value) =>
    /^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/.test(value ?? "") && parseFloat(value) > 0;
  if (width !== undefined && !positive(width)) fail(width, "positive SVG width in pixels");
  if (height !== undefined && !positive(height)) fail(height, "positive SVG height in pixels");
  if (viewBox !== undefined) {
    const box = viewBox.trim().split(/[\s,]+/).map(Number);
    if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) {
      fail(viewBox, "SVG viewBox with four numbers and positive width/height");
    }
  }
  if (viewBox === undefined && !(positive(width) && positive(height))) {
    fail(root.attributes, "SVG viewBox or positive width and height");
  }
}
function checkMetadata(directory, name, fail) {
  const path = resolve(directory, "agents/openai.yaml");
  if (!existsSync(path)) {
    fail(path, "existing agents/openai.yaml");
    return;
  }
  if (!physicallyInside(directory, path)) {
    fail("agents/openai.yaml", "local resource inside the skill directory");
    return;
  }
  let metadata;
  try {
    metadata = Bun.YAML.parse(textOf(path))?.interface;
  } catch (error) {
    fail(error.message, "valid agents/openai.yaml YAML");
    return;
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail(metadata, "interface mapping in agents/openai.yaml");
    return;
  }
  if (typeof metadata.display_name !== "string" || !metadata.display_name.trim()) {
    fail(metadata.display_name, "nonempty interface.display_name string");
  }
  const description = metadata.short_description;
  if (typeof description !== "string" || description.length < 25 || description.length > 64) {
    fail(description, "interface.short_description string of 25–64 characters");
  }
  const handles = typeof metadata.default_prompt === "string"
    ? metadata.default_prompt.match(/\$[a-z][a-z0-9-]*/g) ?? []
    : [];
  if (!handles.includes(`$${name}`)) {
    fail(metadata.default_prompt, `interface.default_prompt containing exact $${name} handle`);
  }
  if (metadata.brand_color !== undefined && !/^#[0-9a-f]{6}$/i.test(metadata.brand_color)) {
    fail(metadata.brand_color, "six-digit interface.brand_color hex color");
  }
  for (const field of ["icon_small", "icon_large"]) {
    const value = metadata[field];
    if (typeof value !== "string" || isAbsolute(value) || value.includes("\\")) {
      fail(value, `relative ${field} asset path using forward slashes`);
      continue;
    }
    const asset = resolve(directory, value);
    if (
      !existsSync(asset) || !physicallyInside(directory, asset) || !statSync(asset).isFile()
    ) {
      fail(value, `existing ${field} asset inside skill directory`);
      continue;
    }
    if (asset.endsWith(".svg")) {
      checkSvg(asset, (invalid, expected) => fail(`${value}: ${describe(invalid)}`, expected));
    }
  }
}

/** Validate every bundled skill and its bundled Markdown; returns diagnostics without changing files. Example: validateSkills('./'). */
export function validateSkills(root = resolve(here, "..")) {
  root = resolve(root);
  const errors = [];
  const failAt = (path) => (value, expected) =>
    errors.push(
      `${relative(root, path) || "."}: expected ${expected}; received ${describe(value)}`,
    );
  const skills = readdirSync(root, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory() && existsSync(resolve(root, entry.name, "SKILL.md"))
  );
  if (!skills.length) failAt(root)(0, "at least one directory containing SKILL.md");
  let markdown = 0;
  for (const skill of skills) {
    const directory = resolve(root, skill.name);
    const path = resolve(directory, "SKILL.md");
    const fail = failAt(path);
    if (!physicallyInside(directory, path)) {
      fail("SKILL.md", "local resource inside the skill directory");
      continue;
    }
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(textOf(path));
    let frontmatter;
    try {
      frontmatter = match ? Bun.YAML.parse(match[1]) : null;
    } catch (error) {
      fail(error.message, "valid SKILL.md YAML frontmatter");
    }
    if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
      fail(frontmatter, "YAML frontmatter mapping delimited by ---");
    } else {
      if (frontmatter.name !== skill.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(frontmatter.name)) {
        fail(
          frontmatter.name,
          `name matching directory ${skill.name} (lowercase letters, digits, hyphens)`,
        );
      }
      if (typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
        fail(frontmatter.description, "nonempty description string");
      }
    }
    checkMetadata(directory, skill.name, failAt(resolve(directory, "agents/openai.yaml")));
    for (const document of markdownFiles(directory, directory, failAt)) {
      markdown++;
      checkMarkdown(document, directory, failAt(document));
    }
  }
  return { skills: skills.length, markdown, errors };
}

/** Run validation and emit human or JSON diagnostics; returns process exit code. Example: main(['--json']). */
export function main(args = []) {
  const unknown = args.filter((argument) => argument.startsWith("--") && argument !== "--json");
  const paths = args.filter((argument) => !argument.startsWith("--"));
  if (unknown.length || paths.length > 1) {
    throw new Error(`Invalid arguments ${JSON.stringify(args)}; expected [ROOT] [--json]`);
  }
  const report = validateSkills(paths[0]);
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    for (const error of report.errors) console.error(error);
    console.log(
      `${report.skills} skills, ${report.markdown} Markdown files, ${report.errors.length} errors`,
    );
  }
  return report.errors.length ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
