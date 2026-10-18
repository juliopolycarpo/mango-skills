/** Decide whether main needs a release and which version it gets. Reads only the source tree. */
import { createHash } from "node:crypto";
import { BUNDLE, plannedPackages } from "./package-skills.mjs";

// Version fields and archive names are fixed at this value so only the payload affects digests.
const DIGEST_VERSION = "0.0.0";
const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const BREAKING_SUBJECT = /^\w+(?:\([^()\r\n]*\))?!:/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;
const describe = (value) => value === undefined ? "missing" : JSON.stringify(value);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function filesDigest(files) {
  const lines = files
    .map((file) => JSON.stringify([file.path, file.mode ?? 0o644, sha256(Buffer.from(file.data))]))
    .sort();
  return `sha256:${sha256(lines.join("\n"))}`;
}

/**
 * Hash every planned artifact's paths, modes and bytes, built at a fixed version so release
 * numbers and archive names add no noise. `skills` maps each skill to its own plugin's digest.
 * Example: payloadDigest(".").digest // "sha256:…"
 */
export function payloadDigest(root) {
  const artifacts = plannedPackages(root, DIGEST_VERSION);
  const skills = {};
  for (const artifact of artifacts) {
    if (artifact.kind === "plugin") skills[artifact.skills[0]] = filesDigest(artifact.files);
  }
  const digest = `sha256:${
    sha256(
      artifacts.map((artifact) => `${artifact.name} ${filesDigest(artifact.files)}`).join("\n"),
    )
  }`;
  return { digest, skills };
}

/**
 * Report whether a commit message carries a Conventional Commits breaking marker: `!` before the
 * subject colon or a `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer line.
 * Example: isBreaking("feat(api)!: drop v1") // true
 */
export function isBreaking(message) {
  const [subject, ...body] = message.split(/\r?\n/);
  return BREAKING_SUBJECT.test(subject) || BREAKING_FOOTER.test(body.join("\n"));
}

/**
 * Compute the next release version: 0.1.0 first, a minor bump when any message is breaking, and
 * a patch bump otherwise. The major never moves.
 * Example: nextVersion("0.1.0", ["fix: typo"]) // "0.1.1"
 */
export function nextVersion(previous, messages) {
  if (previous == null) return "0.1.0";
  const match = RELEASE_VERSION.exec(previous);
  if (!match) {
    throw new Error(
      `(previous version): expected MAJOR.MINOR.PATCH such as 0.1.0 | received: ${
        describe(previous)
      }`,
    );
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  return messages.some(isBreaking) ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

/**
 * Reject a published release.json that lacks a valid version, source SHA, payload digest or skill
 * digests, naming the field.
 * Example: checkReleaseRecord(JSON.parse(readFileSync("release.json", "utf8")))
 */
export function checkReleaseRecord(record) {
  const fail = (field, expected) => {
    throw new Error(
      `(release.json ${field}): expected ${expected} | received: ${describe(record?.[field])}`,
    );
  };
  if (!record || typeof record !== "object") {
    throw new Error(`(release.json): expected JSON object | received: ${describe(record)}`);
  }
  if (!RELEASE_VERSION.test(record.version ?? "")) fail("version", "MAJOR.MINOR.PATCH");
  if (!SHA.test(record.sourceSha ?? "")) fail("sourceSha", "40-character commit SHA");
  if (!DIGEST.test(record.payloadDigest ?? "")) fail("payloadDigest", "sha256:<64 hex>");
  if (!record.skills || typeof record.skills !== "object") fail("skills", "object of digests");
}

function skillChanges(before, after) {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return names.flatMap((name) => {
    if (!(name in before)) return [{ name, change: "added" }];
    if (!(name in after)) return [{ name, change: "removed" }];
    return before[name] === after[name] ? [] : [{ name, change: "changed" }];
  });
}

/**
 * Decide whether the payload DIGEST needs a release after PREVIOUS (the last published
 * release.json, or null) given the commit MESSAGES since its source.
 * Example: planRelease({ previous: null, digest: payloadDigest("."), messages: [] }).version
 */
export function planRelease({ previous, digest, messages }) {
  if (previous == null) {
    return {
      due: true,
      version: nextVersion(null, messages),
      changedSkills: skillChanges({}, digest.skills),
      reason: "no published release yet",
    };
  }
  checkReleaseRecord(previous);
  const since = `v${previous.version} (${previous.sourceSha.slice(0, 12)})`;
  if (previous.payloadDigest === digest.digest) {
    return {
      due: false,
      version: null,
      changedSkills: [],
      reason: `payload unchanged since ${since}`,
    };
  }
  const changedSkills = skillChanges(previous.skills, digest.skills);
  return {
    due: true,
    version: nextVersion(previous.version, messages),
    changedSkills,
    reason: changedSkills.length
      ? `skill payload changed since ${since}`
      : `packaged files outside skills changed since ${since}`,
  };
}

/**
 * Build the release.json content that records what a release was built from and what it holds.
 * ARCHIVES are buildPackages results.
 * Example: releaseRecord({ version: "0.1.0", sourceSha, digest, archives: built })
 */
export function releaseRecord({ version, sourceSha, digest, archives }) {
  return {
    name: BUNDLE,
    version,
    tag: `v${version}`,
    sourceSha,
    payloadDigest: digest.digest,
    skills: digest.skills,
    files: Object.fromEntries(archives.map((archive) => [archive.file, archive.sha256])),
  };
}
