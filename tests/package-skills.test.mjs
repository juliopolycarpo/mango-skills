import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  archiveErrors,
  buildPackages,
  collectSkills,
  manifestErrors,
  plannedPackages,
  PLUGIN_SCHEMA,
  validatePackages,
} from "../scripts/package-skills.mjs";
import { readZip, writeZip } from "../scripts/zip-archive.mjs";

const svg =
  "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><title>Icon</title><path d=\"M0 0\"/></svg>";
function skill(name) {
  return {
    [`${name}/SKILL.md`]:
      `---\nname: ${name}\ndescription: Use when testing ${name} packaging.\n---\n# ${name}\n\n[Guide](references/guide.md)\n`,
    [`${name}/agents/openai.yaml`]:
      `interface:\n  display_name: ${name} skill\n  short_description: Package the ${name} fixture skill\n  icon_small: ./assets/icon.svg\n  icon_large: ./assets/icon.svg\n  default_prompt: Use $${name} here.\n`,
    [`${name}/assets/icon.svg`]: svg,
    [`${name}/references/guide.md`]: "# Guide\n",
    [`${name}/LICENSE`]: "MIT\n",
  };
}
function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "package-skills-"));
  const all = {
    LICENSE: "MIT License\n",
    "assets/mango-skills.svg": svg,
    ...skill("alpha"),
    ...skill("beta"),
    "beta/scripts/run.mjs": "#!/usr/bin/env node\nconsole.log('ok');\n",
    "beta/scripts/__pycache__/cached.pyc": "ignored",
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
function withBuild(inspect, files) {
  const root = fixture(files);
  const out = join(root, "dist");
  try {
    const built = buildPackages({ root, version: "1.2.3", out });
    inspect({ root, out, built });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function retarget(artifact, change) {
  const files = artifact.files.map((file) => ({ ...file }));
  change(files);
  return writeZip(files);
}

test("a build writes the bundle, one plugin per skill, and checksums", () => {
  withBuild(({ out, built }) => {
    expect(built.map(({ kind, name, file, skills }) => ({ kind, name, file, skills }))).toEqual([
      {
        kind: "bundle",
        name: "mango-skills",
        file: "mango-skills-1.2.3.zip",
        skills: ["alpha", "beta"],
      },
      { kind: "plugin", name: "mango-alpha", file: "mango-alpha-1.2.3.zip", skills: ["alpha"] },
      { kind: "plugin", name: "mango-beta", file: "mango-beta-1.2.3.zip", skills: ["beta"] },
    ]);
    expect(readFileSync(join(out, "SHA256SUMS"), "utf8")).toBe(
      built.map((artifact) => `${artifact.sha256}  ${artifact.file}\n`).join(""),
    );
  });
});

test("built packages pass archive validation", () => {
  withBuild(({ root, out }) => {
    expect(validatePackages({ root, version: "1.2.3", out })).toEqual([]);
  });
});

test("rebuilding the same source produces identical checksums", () => {
  withBuild(({ root, out, built }) => {
    const again = buildPackages({ root, version: "1.2.3", out: join(out, "again") });
    expect(again.map((artifact) => artifact.sha256)).toEqual(
      built.map((artifact) => artifact.sha256),
    );
  });
});

test("bundle layout uses the portable manifest, Codex overlay, fixed skills path and modes", () => {
  withBuild(({ out }) => {
    const entries = readZip(readFileSync(join(out, "mango-skills-1.2.3.zip")));
    const paths = entries.filter((entry) => entry.type === "file").map((entry) => entry.path);
    expect(paths).toEqual([
      "mango-skills/.codex-plugin/plugin.json",
      "mango-skills/LICENSE",
      "mango-skills/assets/mango-skills.svg",
      "mango-skills/plugin.json",
      "mango-skills/skills/alpha/LICENSE",
      "mango-skills/skills/alpha/SKILL.md",
      "mango-skills/skills/alpha/agents/openai.yaml",
      "mango-skills/skills/alpha/assets/icon.svg",
      "mango-skills/skills/alpha/references/guide.md",
      "mango-skills/skills/beta/LICENSE",
      "mango-skills/skills/beta/SKILL.md",
      "mango-skills/skills/beta/agents/openai.yaml",
      "mango-skills/skills/beta/assets/icon.svg",
      "mango-skills/skills/beta/references/guide.md",
      "mango-skills/skills/beta/scripts/run.mjs",
    ]);
    const modes = Object.fromEntries(entries.map((entry) => [entry.path, entry.mode]));
    expect(modes["mango-skills/skills/beta/scripts/run.mjs"]).toBe(0o755);
    expect(modes["mango-skills/skills/beta/SKILL.md"]).toBe(0o644);
    const manifest = JSON.parse(
      entries.find((entry) => entry.path === "mango-skills/plugin.json").data,
    );
    expect(manifest.$schema).toBe(PLUGIN_SCHEMA);
    expect(manifest.version).toBe("1.2.3");
  });
});

test("an individual plugin uses the skill's listing metadata and icon", () => {
  withBuild(({ out }) => {
    const entries = readZip(readFileSync(join(out, "mango-alpha-1.2.3.zip")));
    const manifest = JSON.parse(
      entries.find((entry) => entry.path === "mango-alpha/plugin.json").data,
    );
    expect(manifest.description).toBe("Package the alpha fixture skill");
    expect(manifest.extensions["com.openai"].interface).toMatchObject({
      displayName: "alpha skill",
      longDescription: "Use when testing alpha packaging.",
      logo: "./skills/alpha/assets/icon.svg",
    });
  });
});

test("archive validation reports missing, extra, changed and escaping entries", () => {
  withBuild(({ root }) => {
    const [bundle] = plannedPackages(root, "1.2.3");
    const check = (change) => archiveErrors(retarget(bundle, change), bundle, root, "1.2.3");
    expect(
      check((files) => files.splice(files.findIndex((file) => file.path.endsWith("guide.md")), 1)),
    )
      .toContain(
        "expected every source skill file packaged; received missing skills/alpha/references/guide.md",
      );
    expect(check((files) => files.push({ path: "mango-skills/skills/alpha/notes.txt", data: "x" })))
      .toContain("expected only source skill files; received extra skills/alpha/notes.txt");
    expect(check((files) => {
      files.find((file) => file.path.endsWith("alpha/LICENSE")).data = "changed";
    })).toContain("expected packaged bytes matching the source; received skills/alpha/LICENSE");
    expect(check((files) => files.push({ path: "outside.txt", data: "x" })))
      .toContain("expected every entry inside mango-skills/; received outside.txt");
    expect(
      check((files) => files.push({ path: "mango-skills/skills/Alpha/x.md", data: "x" })).join(
        "\n",
      ),
    )
      .toContain("expected paths unique after case folding");
  });
});

test("archive validation requires the Codex overlay to match the portable manifest", () => {
  withBuild(({ root }) => {
    const [bundle] = plannedPackages(root, "1.2.3");
    const data = retarget(bundle, (files) => {
      const overlay = files.find((file) => file.path.endsWith(".codex-plugin/plugin.json"));
      overlay.data = JSON.stringify({ ...JSON.parse(overlay.data), version: "1.2.2" });
    });
    expect(archiveErrors(data, bundle, root, "1.2.3")).toContain(
      ".codex-plugin/plugin.json: expected version matching plugin.json \"1.2.3\"; received version: \"1.2.2\"",
    );
  });
});

test("extracted skills are checked for broken references", () => {
  withBuild(({ root }) => {
    const plugin = plannedPackages(root, "1.2.3").find((artifact) =>
      artifact.name === "mango-alpha"
    );
    const data = retarget(plugin, (files) => {
      files.find((file) => file.path === "mango-alpha/skills/alpha/SKILL.md").data +=
        "\n[Gone](references/gone.md)\n";
    });
    expect(archiveErrors(data, plugin, root, "1.2.3").join("\n")).toContain(
      "expected existing local target",
    );
  });
});

test("an individual plugin may not carry the bundle icon", () => {
  withBuild(({ root }) => {
    const plugin = plannedPackages(root, "1.2.3").find((artifact) =>
      artifact.name === "mango-alpha"
    );
    const data = retarget(
      plugin,
      (files) => files.push({ path: "mango-alpha/assets/mango-skills.svg", data: svg }),
    );
    expect(archiveErrors(data, plugin, root, "1.2.3")).toContain(
      "expected only skill content, manifests and LICENSE; received assets/mango-skills.svg",
    );
  });
});

test("the Codex overlay may not declare components the portable manifest lacks", () => {
  withBuild(({ root }) => {
    const [bundle] = plannedPackages(root, "1.2.3");
    const data = retarget(bundle, (files) => {
      const overlay = files.find((file) => file.path.endsWith(".codex-plugin/plugin.json"));
      overlay.data = JSON.stringify({ ...JSON.parse(overlay.data), mcpServers: "./.mcp.json" });
    });
    expect(archiveErrors(data, bundle, root, "1.2.3")).toContain(
      ".codex-plugin/plugin.json: expected only plugin.json fields, skills and interface; received mcpServers",
    );
  });
});

test("building keeps unrelated archives in the output directory", () => {
  withBuild(({ root, out }) => {
    writeFileSync(join(out, "unrelated.zip"), "keep");
    writeFileSync(join(out, "skill-alpha-1.2.3.zip"), "not ours");
    writeFileSync(join(out, "mango-alpha-1.0.0.zip"), "stale");
    buildPackages({ root, version: "1.2.3", out });
    expect(readFileSync(join(out, "unrelated.zip"), "utf8")).toBe("keep");
    expect(readFileSync(join(out, "skill-alpha-1.2.3.zip"), "utf8")).toBe("not ours");
    expect(readdirSync(out)).not.toContain("mango-alpha-1.0.0.zip");
  });
});

test("package validation reports checksum mismatches and unexpected archives", () => {
  withBuild(({ root, out }) => {
    writeFileSync(join(out, "mango-stray.zip"), writeZip([{ path: "x/y", data: "" }]));
    writeFileSync(join(out, "SHA256SUMS"), "0".repeat(64) + "  mango-alpha-1.2.3.zip\n");
    const errors = validatePackages({ root, version: "1.2.3", out });
    expect(errors[0]).toContain("expected archives");
    expect(errors[0]).toContain("\"mango-stray.zip\"");
    expect(errors).toContainEqual(expect.stringMatching(
      /^SHA256SUMS: expected mango-alpha-1\.2\.3\.zip [0-9a-f]{64}; received "0{64}"$/,
    ));
  });
});

test("manifest validation names each listing rule a manifest breaks", () => {
  const manifest = {
    $schema: "https://example.com/schema.json",
    name: "mango.skills",
    version: "1.2",
    skills: "./skills/",
    extensions: {
      "com.openai": {
        apps: "./.app.json",
        interface: {
          displayName: "Mango",
          shortDescription: "A subtitle that is longer than thirty characters",
          capabilities: "Interactive",
          defaultPrompt: ["one", "two", "three", "four"],
          websiteURL: "http://example.com",
          logo: "./assets/missing.svg",
        },
      },
    },
  };
  expect(manifestErrors(manifest, { name: "mango.skills", version: "1.2", hasFile: () => false }))
    .toEqual([
      `plugin.json: expected $schema ${PLUGIN_SCHEMA}; received "https://example.com/schema.json"`,
      "plugin.json: expected name mango.skills (lowercase letters, digits, hyphens); received \"mango.skills\"",
      "plugin.json: expected strict SemVer version 1.2; received \"1.2\"",
      "plugin.json: expected no top-level skills in the portable manifest; received skills",
      "plugin.json: expected no app declarations in a skills-only plugin; received apps: \"./.app.json\"",
      "plugin.json: expected interface nonblank string of at most 30 characters; received shortDescription: \"A subtitle that is longer than thirty characters\"",
      "plugin.json: expected interface capabilities array of nonblank strings; received capabilities: \"Interactive\"",
      "plugin.json: expected interface defaultPrompt of up to three single-line strings of at most 128 characters; received defaultPrompt: [\"one\",\"two\",\"three\",\"four\"]",
      "plugin.json: expected interface websiteURL absolute HTTPS URL; received websiteURL: \"http://example.com\"",
      "plugin.json: expected interface logo contained ./ path to a packaged file; received logo: \"./assets/missing.svg\"",
    ]);
});

test("an invalid version is rejected before any archive is written", () => {
  const root = fixture();
  try {
    expect(() => buildPackages({ root, version: "v1.2.3", out: join(root, "dist") })).toThrow(
      "(--version): expected strict SemVer such as 1.2.3 | received: \"v1.2.3\"",
    );
    expect(readdirSync(root)).not.toContain("dist");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a symlink inside a skill is rejected instead of being followed", () => {
  const root = fixture();
  try {
    try {
      symlinkSync(join(root, "LICENSE"), join(root, "alpha/linked"));
    } catch {
      return; // Creating symlinks needs extra privileges on some Windows runners.
    }
    expect(() => collectSkills(root)).toThrow(
      "(linked): expected regular file or directory | received: symlink",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the repository's own skills package without validation errors", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const out = mkdtempSync(join(tmpdir(), "package-repository-"));
  try {
    const built = buildPackages({ root, version: "0.0.0", out });
    const skills = readdirSync(root).filter((name) => {
      try {
        return readFileSync(join(root, name, "SKILL.md")).length > 0;
      } catch {
        return false;
      }
    });
    expect(built[0].skills).toEqual(skills.sort());
    expect(validatePackages({ root, version: "0.0.0", out })).toEqual([]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
