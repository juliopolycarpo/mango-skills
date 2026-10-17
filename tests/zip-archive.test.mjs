import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readZip, writeZip } from "../scripts/zip-archive.mjs";

const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const files = [
  { path: "pkg/skills/a/SKILL.md", data: "---\nname: a\n---\n" },
  { path: "pkg/skills/a/scripts/run.mjs", data: "#!/usr/bin/env node\n", mode: 0o755 },
  { path: "pkg/plugin.json", data: "{}\n".repeat(200) },
];

test("written entries read back with parents, sorted paths, contents and modes", () => {
  const entries = readZip(writeZip(files));
  expect(entries.map((entry) => [entry.path, entry.type, entry.mode])).toEqual([
    ["pkg/", "directory", 0o755],
    ["pkg/plugin.json", "file", 0o644],
    ["pkg/skills/", "directory", 0o755],
    ["pkg/skills/a/", "directory", 0o755],
    ["pkg/skills/a/SKILL.md", "file", 0o644],
    ["pkg/skills/a/scripts/", "directory", 0o755],
    ["pkg/skills/a/scripts/run.mjs", "file", 0o755],
  ]);
  expect(entries.find((entry) => entry.path === "pkg/plugin.json").data.toString()).toBe(
    "{}\n".repeat(200),
  );
});

test("equal inputs produce identical bytes regardless of input order", () => {
  expect(writeZip(files).equals(writeZip([...files].reverse()))).toBe(true);
});

test("Python's zipfile extracts the archive with matching contents", () => {
  const directory = mkdtempSync(join(tmpdir(), "zip-archive-"));
  try {
    const archive = join(directory, "test.zip");
    writeFileSync(archive, writeZip(files));
    const script =
      "import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(z.read('pkg/skills/a/SKILL.md').decode(), end='')";
    const result = spawnSync(python, ["-I", "-c", script, archive], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("---\nname: a\n---\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("unsafe or duplicate entry paths are rejected before writing", () => {
  for (const path of ["../escape", "/absolute", "pkg\\windows", "pkg//empty", "C:/drive"]) {
    expect(() => writeZip([{ path, data: "" }])).toThrow(
      `expected relative forward-slash path without empty, . or .. parts | received: ${
        JSON.stringify(path)
      }`,
    );
  }
  expect(() => writeZip([files[0], files[0]])).toThrow(
    "expected unique path | received duplicate: pkg/skills/a/SKILL.md",
  );
});

test("corrupted contents and truncated archives fail with the violated expectation", () => {
  const archive = writeZip([{ path: "pkg/a.txt", data: "abc" }]);
  const corrupted = Buffer.from(archive);
  corrupted[corrupted.indexOf("abc")] = "x".charCodeAt(0);
  expect(() => readZip(corrupted)).toThrow("expected matching CRC-32 for pkg/a.txt");
  expect(() => readZip(archive.subarray(0, 40))).toThrow(
    "expected end of central directory record | received: none",
  );
});

test("symlink entries are reported by type", () => {
  const archive = writeZip([{ path: "pkg/link", data: "target" }]);
  const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), 0);
  const entries = readZip(archive);
  // Rewrite the second central header (the file; the first is pkg/) to a Unix symlink mode.
  const file = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), central + 4);
  archive.writeUInt32LE((0o120777 << 16) >>> 0, file + 38);
  expect(entries.find((entry) => entry.path === "pkg/link").type).toBe("file");
  expect(readZip(archive).find((entry) => entry.path === "pkg/link").type).toBe("symlink");
});

test("offsets outside the archive fail with the violated expectation", () => {
  const archive = writeZip([{ path: "pkg/a.txt", data: "abc" }]);
  const end = archive.length - 22;
  const outside = Buffer.from(archive);
  outside.writeUInt32LE(9_999_999, end + 16);
  expect(() => readZip(outside)).toThrow(
    "(zip archive): expected central directory header within archive | received: offset 9999999",
  );
});

test("a local header that disagrees with the central directory is rejected", () => {
  const archive = writeZip([{ path: "pkg/a.txt", data: "abc" }]);
  archive.write("q", archive.indexOf("pkg/a.txt") /* first occurrence is the local header */);
  expect(() => readZip(archive)).toThrow(
    "(zip archive): expected local header matching central directory for pkg/a.txt | received: qkg/a.txt",
  );
});
