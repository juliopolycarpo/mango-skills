import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, validateSkills } from "./validate-skills.mjs";

const validSkill =
  "---\nname: example\ndescription: Use when testing structural skill validation.\n---\n# Example\n\n[Details](references/details.md#repeated-heading-1)\n\n[Same page](#example)\n";
const validMetadata = `interface:
  display_name: Example skill
  short_description: Validate the maintained skill structure
  icon_small: ./assets/icon.svg
  icon_large: ./assets/icon.svg
  default_prompt: Use $example to validate this fixture.
  brand_color: '#0369A1'
`;
const validSvg =
  "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><title>Example</title><path d=\"M0 0\"/></svg>";
function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "skills-structural-check-"));
  const defaults = {
    "example/SKILL.md": validSkill,
    "example/agents/openai.yaml": validMetadata,
    "example/assets/icon.svg": validSvg,
    "example/references/details.md": "# Details\n\n## Repeated heading\n\n## Repeated heading\n",
  };
  for (const [path, content] of Object.entries({ ...defaults, ...files })) {
    if (content === null) continue;
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return {
    root,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function withFixture(files, inspect) {
  const tree = fixture(files);
  try {
    inspect(tree.root);
  } finally {
    tree.cleanup();
  }
}

test("valid skill, metadata, duplicate heading anchor and SVG pass", () => {
  withFixture(
    {},
    (root) => expect(validateSkills(root)).toEqual({ skills: 1, markdown: 2, errors: [] }),
  );
});

test("metadata identifies a skill whose entrypoint was removed", () => {
  withFixture({ "removed/agents/openai.yaml": validMetadata }, (root) => {
    expect(validateSkills(root).errors).toContain(
      `${join("removed", "SKILL.md")}: expected existing SKILL.md entrypoint; received "missing"`,
    );
  });
});

test("README inventory catches a removed advertised skill directory", () => {
  withFixture({
    "README.md": "# Skills\n\n[Example](example/SKILL.md)\n[Missing](missing/SKILL.md)\n",
  }, (root) => {
    expect(
      validateSkills(root).errors.some((message) =>
        message.includes("missing/SKILL.md") && message.includes("existing local target")
      ),
    ).toBe(true);
  });
});

test("README inventory requires each discovered skill to be advertised", () => {
  withFixture({
    "README.md": "# Skills\n\n[Contribute](CONTRIBUTING.md)\n",
    "CONTRIBUTING.md": "# Contribute\n",
  }, (root) => {
    expect(validateSkills(root).errors).toContain(
      "README.md: expected README link to example/SKILL.md; received \"example\"",
    );
  });
});

test("README validates repository links and anchors without skill confinement", () => {
  withFixture({
    "README.md":
      "# Skills\n\n[Example](./example/SKILL.md#example)\n[Contribute](docs/contributing.md#contribute)\n[Broken](docs/contributing.md#absent)\n[Outside](../outside.md)\n",
    "docs/contributing.md": "# Contribute\n",
  }, (root) => {
    const errors = validateSkills(root).errors;
    expect(errors).toHaveLength(2);
    expect(
      errors.some((message) =>
        message.includes("#absent") && message.includes("existing heading anchor")
      ),
    ).toBe(true);
    expect(
      errors.some((message) =>
        message.includes("../outside.md") && message.includes("inside the repository")
      ),
    ).toBe(true);
  });
});

test("frontmatter malformed YAML, missing descriptions and directory mismatch name fail clearly", () => {
  for (
    const [frontmatter, expected] of [
      ["name: [unterminated", "valid SKILL.md YAML"],
      ["name: wrong\ndescription: Example", "name matching directory example"],
      ["name: example\ndescription: 42", "nonempty description string"],
    ]
  ) {
    withFixture({ "example/SKILL.md": `---\n${frontmatter}\n---\n# Example` }, (root) => {
      expect(validateSkills(root).errors.some((message) => message.includes(expected))).toBe(true);
    });
  }
  withFixture(
    { "example/SKILL.md": "# Missing frontmatter" },
    (root) => expect(validateSkills(root).errors[0]).toContain("YAML frontmatter mapping"),
  );
});

test("local targets, encoded names and heading anchors are validated in supporting references", () => {
  const details =
    "# Details\n\n[Absent](missing.md)\n[Absent anchor](../SKILL.md#missing)\n[Encoded](space%20name.md#encoded)\n[External](https://example.test/missing#missing)";
  withFixture({
    "example/references/details.md": details,
    "example/references/space name.md": "# Encoded",
  }, (root) => {
    const errors = validateSkills(root).errors;
    expect(
      errors.some((message) =>
        message.includes("missing.md") && message.includes("existing local target")
      ),
    ).toBe(true);
    expect(
      errors.some((message) =>
        message.includes("#missing") && message.includes("existing heading anchor")
      ),
    ).toBe(true);
    expect(errors.some((message) => message.includes("space%20name"))).toBe(false);
    expect(errors.some((message) => message.includes("https://"))).toBe(false);
  });
});

test("code fences and inline code are ignored; reference-style links and balanced paths work", () => {
  const source = `---
name: example
description: Use for fixture validation.
---
# Example

\`[Ignored](absent-inline.md)\`

~~~markdown
[Ignored](absent-fenced.md)
## Hidden heading
~~~

\`\`\`\`markdown
[Ignored](absent-four-backticks.md)
\`\`\`
[Still ignored](absent-in-long-fence.md)
\`\`\`\`

[Reference][detail]
[detail][]
[detail]
[Balanced](references/with(parentheses).md#parentheses)
[Setext](references/setext.md#setext-heading)
[Explicit](references/explicit.md#custom)

[detail]: references/details.md#repeated-heading
`;
  withFixture({
    "example/SKILL.md": source,
    "example/references/with(parentheses).md": "# Parentheses",
    "example/references/setext.md": "Setext heading\n==============\n",
    "example/references/explicit.md": "<a id=\"custom\"></a>\n# Details",
  }, (root) => expect(validateSkills(root).errors).toEqual([]));
});

test("undefined reference, invalid encoded destination, and hidden heading report errors", () => {
  withFixture({
    "example/SKILL.md":
      `${validSkill}\n[Undefined][missing-label]\n[Bad encoding](%zz.md)\n[Hidden](#hidden)\n\n\`\`\`\n# Hidden\n\`\`\``,
  }, (root) => {
    const errors = validateSkills(root).errors;
    expect(errors.some((message) => message.includes("defined Markdown reference label"))).toBe(
      true,
    );
    expect(errors.some((message) => message.includes("valid URL-encoded"))).toBe(true);
    expect(
      errors.some((message) =>
        message.includes("#hidden") && message.includes("existing heading anchor")
      ),
    ).toBe(true);
  });
});

test("UI metadata requires bounded short text, exact handle and local assets", () => {
  const bad = validMetadata.replace("Validate the maintained skill structure", "Short").replace(
    "$example ",
    "$example-other ",
  ).replace("./assets/icon.svg", "../outside.svg");
  withFixture({ "example/agents/openai.yaml": bad }, (root) => {
    const errors = validateSkills(root).errors;
    expect(errors.some((message) => message.includes("25–64 characters"))).toBe(true);
    expect(errors.some((message) => message.includes("exact $example handle"))).toBe(true);
    expect(errors.some((message) => message.includes("asset inside skill directory"))).toBe(true);
  });
  withFixture(
    { "example/agents/openai.yaml": "interface: [invalid" },
    (root) =>
      expect(
        validateSkills(root).errors.some((message) =>
          message.includes("valid agents/openai.yaml YAML")
        ),
      ).toBe(true),
  );
  withFixture(
    { "example/agents/openai.yaml": null },
    (root) =>
      expect(
        validateSkills(root).errors.some((message) =>
          message.includes("existing agents/openai.yaml")
        ),
      ).toBe(true),
  );
});

test("strict XML parser rejects malformed XML and wrong root, title, dimensions", () => {
  for (
    const [svg, expected] of [
      ["<svg><title>Broken</svg>", "well-formed SVG XML"],
      ["<html/>", "svg root"],
      ["<svg/><svg/>", "well-formed SVG XML"],
      [
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\"/>",
        "nonempty SVG title",
      ],
      [validSvg.replace("0 0 64 64", "0 0 0 64"), "four numbers and positive"],
      [
        validSvg.replace("viewBox=\"0 0 64 64\"", "width=\"-2\" height=\"64\""),
        "positive SVG width",
      ],
      [validSvg.replace(" viewBox=\"0 0 64 64\"", ""), "viewBox or positive width and height"],
    ]
  ) {
    withFixture(
      { "example/assets/icon.svg": svg },
      (root) =>
        expect(validateSkills(root).errors.some((message) => message.includes(expected))).toBe(
          true,
        ),
    );
  }
});

test("valid width and height SVG dimensions work without viewBox", () => {
  withFixture({
    "example/assets/icon.svg": validSvg.replace(
      "viewBox=\"0 0 64 64\"",
      "width=\"64px\" height=\"64\"",
    ),
  }, (root) => expect(validateSkills(root).errors).toEqual([]));
});

test("CLI produces JSON and meaningful exit status; invalid arguments fail", () => {
  const script = fileURLToPath(new URL("./validate-skills.mjs", import.meta.url));
  withFixture({}, (root) => {
    const result = spawnSync(process.execPath, [script, root, "--json"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).skills).toBe(1);
  });
  withFixture({ "example/assets/icon.svg": "<broken>" }, (root) => {
    const result = spawnSync(process.execPath, [script, root, "--json"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors.length).toBeGreaterThan(0);
  });
  expect(() => main(["--unknown"])).toThrow("expected [ROOT] [--json]");
});

test("empty root fails rather than reporting an empty inventory as success", () => {
  const root = mkdtempSync(join(tmpdir(), "skills-empty-check-"));
  try {
    expect(validateSkills(root).errors[0]).toContain("at least one directory containing SKILL.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("skill documentation cannot depend on an existing sibling resource", () => {
  withFixture({
    "example/references/details.md":
      "# Details\n\n## Repeated heading\n\n## Repeated heading\n\n[Shared](../../sibling/references/shared.md)\n",
    "sibling/references/shared.md": "# Shared\n",
  }, (root) => {
    expect(validateSkills(root).errors).toContain(
      `${
        join("example", "references", "details.md")
      }: expected local target inside the skill directory; received "../../sibling/references/shared.md"`,
    );
  });
});

function canCreateFileSymlink() {
  const root = mkdtempSync(join(tmpdir(), "skills-symlink-probe-"));
  try {
    writeFileSync(join(root, "target"), "probe");
    symlinkSync("target", join(root, "link"), "file");
    return true;
  } catch (error) {
    if (process.platform === "win32" && ["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
      return false;
    }
    throw error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const fileSymlinksAvailable = canCreateFileSymlink();

test.skipIf(!fileSymlinksAvailable)(
  "README links cannot escape the repository through symlinks",
  () => {
    const outside = mkdtempSync(join(tmpdir(), "fix-published-skill-review-readme-"));
    try {
      writeFileSync(join(outside, "guide.md"), "# Guide\n");
      withFixture({ "README.md": "[Example](example/SKILL.md)\n[Guide](guide.md)\n" }, (root) => {
        symlinkSync(join(outside, "guide.md"), join(root, "guide.md"), "file");
        expect(validateSkills(root).errors).toContain(
          "README.md: expected local target inside the repository; received \"guide.md\"",
        );
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  },
);

test.skipIf(!fileSymlinksAvailable)(
  "local Markdown symlinks cannot resolve into sibling skills",
  () => {
    withFixture({
      "example/SKILL.md": `${validSkill}\n[Shared](shared.md#shared)\n`,
      "sibling/shared.md": "# Shared\n",
    }, (root) => {
      symlinkSync("../sibling/shared.md", join(root, "example/shared.md"), "file");
      expect(validateSkills(root).errors).toContain(
        `${
          join("example", "SKILL.md")
        }: expected local target inside the skill directory; received "shared.md#shared"`,
      );
    });
  },
);

test("metadata asset directory links cannot resolve into sibling skills", () => {
  withFixture({ "example/assets/icon.svg": null, "sibling/assets/icon.svg": validSvg }, (root) => {
    symlinkSync(
      join(root, "sibling/assets"),
      join(root, "example/assets"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(validateSkills(root).errors).toContain(
      `${
        join("example", "agents", "openai.yaml")
      }: expected existing icon_small asset inside skill directory; received "./assets/icon.svg"`,
    );
  });
});

test.skipIf(!fileSymlinksAvailable)(
  "skill entry and metadata files cannot be symlinked outside their skill",
  () => {
    for (
      const [file, content, expected] of [
        [
          "SKILL.md",
          validSkill,
          `${
            join("example", "SKILL.md")
          }: expected local resource inside the skill directory; received "SKILL.md"`,
        ],
        [
          "agents/openai.yaml",
          validMetadata,
          `${
            join("example", "agents", "openai.yaml")
          }: expected local resource inside the skill directory; received "agents/openai.yaml"`,
        ],
      ]
    ) {
      withFixture({ [`example/${file}`]: null, "sibling/target": content }, (root) => {
        mkdirSync(join(root, "example", file, ".."), { recursive: true });
        symlinkSync(join(root, "sibling/target"), join(root, "example", file), "file");
        expect(validateSkills(root).errors).toContain(expected);
      });
    }
  },
);

test.skipIf(!fileSymlinksAvailable)(
  "internal relative file and directory symlinks remain valid",
  () => {
    withFixture({
      "example/SKILL.md": null,
      "example/entry.md": validSkill,
      "example/agents/openai.yaml": null,
      "example/agents/source.yaml": validMetadata,
      "example/assets/icon.svg": null,
      "example/images/icon.svg": validSvg,
    }, (root) => {
      symlinkSync("entry.md", join(root, "example/SKILL.md"), "file");
      symlinkSync("source.yaml", join(root, "example/agents/openai.yaml"), "file");
      symlinkSync(
        process.platform === "win32" ? join(root, "example/images") : "images",
        join(root, "example/assets"),
        process.platform === "win32" ? "junction" : "dir",
      );
      expect(validateSkills(root).errors).toEqual([]);
    });
  },
);

test("internal directory links are inspected without recursing through cycles", () => {
  withFixture({ "example/docs/linked.md": "# Linked\n\n[Absent](missing.md)\n" }, (root) => {
    const type = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(join(root, "example/docs"), join(root, "example/references/alias"), type);
    symlinkSync(join(root, "example"), join(root, "example/docs/loop"), type);
    expect(validateSkills(root).errors).toContain(
      `${join("example", "references", "alias", "linked.md")}: expected existing local target (${
        join(root, "example/references/alias/missing.md")
      }); received "missing.md"`,
    );
  });
});
