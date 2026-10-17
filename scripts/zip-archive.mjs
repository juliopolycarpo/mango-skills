/** Deterministic ZIP writing and strict reading with node: APIs only. */
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
// 1980-01-01 00:00:00, the earliest DOS timestamp, so archives do not depend on build time.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const UTF8 = 0x0800;
const UNIX = 3 << 8;
const FILE_TYPE = 0o100000;
const DIRECTORY_TYPE = 0o040000;
const TYPE_MASK = 0o170000;

function header(size, fields) {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  for (const [bytes, value] of fields) {
    if (bytes === 2) buffer.writeUInt16LE(value, offset);
    else buffer.writeUInt32LE(value >>> 0, offset);
    offset += bytes;
  }
  return buffer;
}

function checkPath(path) {
  const parts = path.replace(/\/$/, "").split("/");
  if (
    !path || path.startsWith("/") || path.includes("\\") || /^[a-z]:/i.test(path)
    || parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(
      `(zip entry): expected relative forward-slash path without empty, . or .. parts | received: ${
        JSON.stringify(path)
      }`,
    );
  }
}

/**
 * Build a ZIP whose bytes depend only on entry paths, contents and modes. Parent directories are
 * added automatically and entries are sorted, so equal inputs always produce equal checksums.
 * Example: writeZip([{ path: "pkg/SKILL.md", data: Buffer.from("---\n...") }])
 */
export function writeZip(files) {
  const entries = new Map();
  for (const file of files) {
    checkPath(file.path);
    if (file.path.endsWith("/")) {
      throw new Error(`(zip entry): expected file path | received: ${file.path}`);
    }
    if (entries.has(file.path)) {
      throw new Error(`(zip entry): expected unique path | received duplicate: ${file.path}`);
    }
    entries.set(file.path, {
      data: Buffer.from(file.data),
      mode: FILE_TYPE | (file.mode ?? 0o644),
    });
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index++) {
      const directory = `${parts.slice(0, index).join("/")}/`;
      if (!entries.has(directory)) {
        entries.set(directory, { data: Buffer.alloc(0), mode: DIRECTORY_TYPE | 0o755 });
      }
    }
  }
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const path of [...entries.keys()].sort()) {
    const { data, mode } = entries.get(path);
    const name = Buffer.from(path, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    const method = deflated.length < data.length ? 8 : 0;
    const body = method ? deflated : data;
    const checksum = crc32(data);
    const shared = [
      [2, 20],
      [2, UTF8],
      [2, method],
      [2, DOS_TIME],
      [2, DOS_DATE],
      [4, checksum],
      [
        4,
        body.length,
      ],
      [4, data.length],
      [2, name.length],
      [2, 0],
    ];
    const local = Buffer.concat([header(30, [[4, LOCAL], ...shared]), name, body]);
    centrals.push(Buffer.concat([
      header(46, [
        [4, CENTRAL],
        [2, UNIX | 20],
        ...shared,
        [2, 0],
        [2, 0],
        [2, 0],
        [4, mode << 16],
        [
          4,
          offset,
        ],
      ]),
      name,
    ]));
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = header(22, [
    [4, END],
    [2, 0],
    [2, 0],
    [2, centrals.length],
    [2, centrals.length],
    [
      4,
      directory.length,
    ],
    [4, offset],
    [2, 0],
  ]);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * Read every entry of a ZIP, verifying sizes and CRC-32. Rejects ZIP64, encryption, unsupported
 * compression and unsafe paths instead of guessing. Symlinks are reported through `type`.
 * Example: readZip(readFileSync("plugin.zip")).map((entry) => entry.path)
 */
export function readZip(buffer) {
  const fail = (expected, received) => {
    throw new Error(`(zip archive): expected ${expected} | received: ${received}`);
  };
  const within = (offset, length, expected) => {
    if (offset + length > buffer.length) fail(`${expected} within archive`, `offset ${offset}`);
  };
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index--) {
    if (buffer.readUInt32LE(index) === END) {
      end = index;
      break;
    }
  }
  if (end < 0) fail("end of central directory record", "none");
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || cursor === 0xffffffff) fail("non-ZIP64 archive", "ZIP64 markers");
  if (buffer.readUInt32LE(end + 4) !== 0 || buffer.readUInt16LE(end + 8) !== count) {
    fail("single-disk archive", "multi-disk fields");
  }
  const entries = [];
  const seen = new Set();
  for (let index = 0; index < count; index++) {
    within(cursor, 46, "central directory header");
    if (buffer.readUInt32LE(cursor) !== CENTRAL) {
      fail("central directory header", `offset ${cursor}`);
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const madeBy = buffer.readUInt16LE(cursor + 4) >> 8;
    const external = buffer.readUInt32LE(cursor + 38);
    const local = buffer.readUInt32LE(cursor + 42);
    within(cursor + 46, nameLength + extraLength + commentLength, "central directory entry");
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const path = name.toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    checkPath(path);
    if (seen.has(path)) fail("unique entry paths", `duplicate ${path}`);
    seen.add(path);
    if (flags & 1) fail("unencrypted entries", path);
    if (method !== 0 && method !== 8) {
      fail("stored or deflated entries", `${path} method ${method}`);
    }
    const mode = madeBy === 3 ? external >>> 16 : 0;
    const type = (mode & TYPE_MASK) === 0o120000
      ? "symlink"
      : path.endsWith("/") || (mode & TYPE_MASK) === DIRECTORY_TYPE
      ? "directory"
      : "file";
    within(local, 30, `local file header for ${path}`);
    if (buffer.readUInt32LE(local) !== LOCAL) fail("local file header", `${path} at ${local}`);
    const localName = buffer.subarray(local + 30, local + 30 + buffer.readUInt16LE(local + 26));
    // Extractors such as Python's zipfile reject entries whose two headers disagree.
    if (
      !localName.equals(name) || buffer.readUInt16LE(local + 8) !== method
      || (!(flags & 8) && (buffer.readUInt32LE(local + 14) !== checksum
        || buffer.readUInt32LE(local + 18) !== compressed
        || buffer.readUInt32LE(local + 22) !== size))
    ) {
      fail(`local header matching central directory for ${path}`, localName.toString("utf8"));
    }
    const start = local + 30 + localName.length + buffer.readUInt16LE(local + 28);
    within(start, compressed, `data for ${path}`);
    const body = buffer.subarray(start, start + compressed);
    let data;
    try {
      // Cap inflation at the declared size so a crafted entry cannot exhaust memory.
      data = method
        ? inflateRawSync(body, { maxOutputLength: Math.max(size, 1) })
        : Buffer.from(body);
    } catch (error) {
      fail(`${size} uncompressed bytes for ${path}`, error.code ?? error.message);
    }
    if (data.length !== size) fail(`${size} uncompressed bytes for ${path}`, data.length);
    if (crc32(data) >>> 0 !== checksum) fail(`matching CRC-32 for ${path}`, "mismatch");
    entries.push({ path, type, mode: mode & 0o7777, data });
  }
  return entries;
}
