#!/usr/bin/env python3
"""Read-only dependency release-age inventory (Python port of eligible-upgrades.mjs).

Example: python3 eligible_upgrades.py --base origin/main --json

Standard library only; targets Python 3.9+. Differences from the JavaScript version are
listed in the docstrings of the functions they affect (synchronous I/O, UTC for naive
timestamps, the shared YAML `uses:` subset in `extract_uses`).
"""
from __future__ import annotations

import http.client
import json
import math
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

Row = Dict[str, Any]
Result = Dict[str, Any]
GitRunner = Callable[[Sequence[str]], str]

SECTIONS = ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")
VALUE_FLAGS = ("--base", "--head", "--min-days", "--resolved")
FETCH_TIMEOUT_SECONDS = 30
GH_TIMEOUT_SECONDS = 60
DAY_MS = 86400000
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
MIN_DATE_MS = -62135596800000  # 0001-01-01T00:00:00.000Z, the earliest datetime Python represents
MAX_DATE_MS = 253402300799999  # 9999-12-31T23:59:59.999Z

STABLE = re.compile(r"v?(\d+)\.(\d+)\.(\d+)", re.ASCII)
SHA40 = re.compile(r"[a-f0-9]{40}", re.ASCII | re.IGNORECASE)
PREVIEW_VERSION = re.compile(r"\d+\.\d+\.\d+-", re.ASCII)
RANGE_SPEC = re.compile(r"[~^]\d+\.\d+\.\d+", re.ASCII)
RANGE_PARTS = re.compile(r"([~^]?)(\d+)\.(\d+)\.(\d+)", re.ASCII)
DIST_TAG = re.compile(r"latest|next|beta|alpha|canary|preview")
ALIAS = re.compile(r"npm:(.+)@([^@]+)")
ACTION_USE = re.compile(r"([\w.-]+/[\w.-]+)(?:/[\w./-]+)?@(.+)", re.ASCII)
VERSION_COMMENT = re.compile(r"#\s*(v?\d+\.\d+\.\d+)\s*\Z", re.ASCII)
GITHUB_REPO = re.compile(r"github\.com[/:]([^/]+/[^/#]+?)(?:\.git)?(?:[#/]|\Z)")
HTTP_STATUS = re.compile(r"^HTTP/\S+ (\d+)", re.MULTILINE)
MANIFEST_PATH = re.compile(r"(?:^|/)package\.json\Z")
YAML_PATH = re.compile(r"\.ya?ml\Z")
UNCOVERED_PATH = re.compile(
    r"(?:^|/)(?:Cargo\.(?:toml|lock)|Dockerfile[^/]*|requirements[^/]*\.txt"
    r"|pyproject\.toml|go\.(?:mod|sum))\Z"
)

# Shared YAML subset; keep identical to the patterns in eligible-upgrades.mjs.
YAML_KEY = re.compile(r"""("[^"]*"|'[^']*'|[^\s:#'"\[{][^:]*?)\s*:(?:\s+(.*))?""", re.ASCII)
YAML_EXPLICIT_KEY = re.compile(r"""\?\s+("uses"|'uses'|uses)\s*""", re.ASCII)
YAML_EXPLICIT_VALUE = re.compile(r":(?:\s+(.*))?", re.ASCII)
YAML_BLOCK_SCALAR = re.compile(r"[|>][+-]?\d?[+-]?\s*(?:#.*)?", re.ASCII)
YAML_NON_STRING = re.compile(r"~|null|true|false|[-+]?[\d_.]+(?:e[-+]?\d+)?", re.ASCII | re.IGNORECASE)
YAML_PROPERTY = re.compile(r"(?:&\S+|!\S*)(?:\s+|\Z)", re.ASCII)
YAML_UNREADABLE = "*%@`|>&!"
YAML_PREFIX = re.compile(r"(?:[ ]*-[ ]+)*[ ]*")

JS_DECIMAL = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", re.ASCII)
JS_RADIX = re.compile(r"0(?:[xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)", re.ASCII)
ISO_TIMESTAMP = re.compile(
    r"(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?"
    r"(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?",
    re.ASCII,
)


class GitError(RuntimeError):
    """A git command failed; the message names the command and the observed failure."""


# --------------------------------------------------------------------------------------
# Version helpers
# --------------------------------------------------------------------------------------


def is_stable(value: Any) -> bool:
    """Return True for a stable `x.y.z` or `vx.y.z` string. Example: is_stable("v1.2.3") -> True."""
    return isinstance(value, str) and STABLE.fullmatch(value) is not None


def version_key(value: str) -> Optional[Tuple[int, int, int]]:
    """Parse a stable version into (major, minor, patch), or None. Example: version_key("v1.2.3") -> (1, 2, 3)."""
    match = STABLE.fullmatch(value) if isinstance(value, str) else None
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)))


def compare(left: str, right: str) -> int:
    """Compare two stable versions: negative, zero or positive. Example: compare("1.2.0", "1.10.0") < 0."""
    first, second = version_key(left), version_key(right)
    if first is None or second is None:
        raise ValueError(
            f"(compare): expected stable versions x.y.z | received: {left!r} and {right!r}"
        )
    return (first > second) - (first < second)


def normalize(version: str) -> str:
    """Strip one leading `v` from a version. Example: normalize("v1.2.3") -> "1.2.3"."""
    return version[1:] if version.startswith("v") else version


def satisfies_range(version: str, spec: str) -> bool:
    """Check a stable version against `^x.y.z`, `~x.y.z` or exact `x.y.z` (npm semantics).

    Any other spec returns False. Example: satisfies_range("1.2.5", "^1.0.0") -> True.
    """
    current = version_key(version)
    match = RANGE_PARTS.fullmatch(spec) if isinstance(spec, str) else None
    if current is None or match is None:
        return False
    operator = match.group(1)
    lower = (int(match.group(2)), int(match.group(3)), int(match.group(4)))
    major, minor, patch = lower
    if not operator:
        return current == lower
    if operator == "~":
        upper = (major, minor + 1, 0)
    elif major > 0:
        upper = (major + 1, 0, 0)
    elif minor > 0:
        upper = (0, minor + 1, 0)
    else:
        upper = (0, 0, patch + 1)
    return lower <= current < upper


# --------------------------------------------------------------------------------------
# Value parsing shared with the CLI
# --------------------------------------------------------------------------------------


def parse_json(text: str) -> Any:
    """Parse strict JSON, rejecting NaN/Infinity like JavaScript. Example: parse_json('{"a": 1}') -> {"a": 1}."""

    def reject(constant: str) -> Any:
        raise ValueError(f"(json): expected strict JSON | received constant: {constant}")

    return json.loads(text, parse_constant=reject)


def js_number(text: str) -> float:
    """Convert text the way JavaScript `Number()` does; NaN when invalid. Example: js_number("1e3") -> 1000.0."""
    value = text.strip()
    if not value:
        return 0.0
    if JS_RADIX.fullmatch(value):
        return float(int(value, 0))
    if JS_DECIMAL.fullmatch(value):
        return float(value)
    infinities = {"Infinity": math.inf, "+Infinity": math.inf, "-Infinity": -math.inf}
    return infinities.get(value, math.nan)


def parse_timestamp(value: Any) -> Optional[int]:
    """Parse an ISO-8601 date or date-time into epoch milliseconds, or None if invalid.

    Date-only and zone-less date-times are read as UTC (JavaScript reads zone-less
    date-times in local time; npm and GitHub always send a zone).
    Example: parse_timestamp("2026-10-01T00:00:00Z") -> 1790812800000.
    """
    if not isinstance(value, str):
        return None
    match = ISO_TIMESTAMP.fullmatch(value.strip())
    if not match:
        return None
    year, month, day, hour, minute, second, fraction, zone = match.groups()
    try:
        moment = datetime(
            int(year), int(month or 1), int(day or 1),
            int(hour or 0), int(minute or 0), int(second or 0),
            tzinfo=timezone.utc,
        )
    except ValueError:
        return None
    delta = moment - EPOCH
    millis = (delta.days * 86400 + delta.seconds) * 1000
    millis += int((fraction or "0")[:3].ljust(3, "0"))
    if zone and zone != "Z":
        digits = zone[1:].replace(":", "")
        offset = int(digits[:2]) * 60 + int(digits[2:4] or 0)
        millis -= (-offset if zone[0] == "-" else offset) * 60000
    return millis


def format_iso(milliseconds: int) -> str:
    """Format epoch milliseconds like JavaScript `toISOString()`. Example: format_iso(0) -> "1970-01-01T00:00:00.000Z"."""
    if not MIN_DATE_MS <= milliseconds <= MAX_DATE_MS:
        raise ValueError(
            f"(format_iso): expected epoch milliseconds between {MIN_DATE_MS} and {MAX_DATE_MS} "
            f"| received: {milliseconds}"
        )
    seconds, millis = divmod(milliseconds, 1000)
    moment = EPOCH + timedelta(seconds=seconds)
    return (
        f"{moment.year:04d}-{moment.month:02d}-{moment.day:02d}"
        f"T{moment.hour:02d}:{moment.minute:02d}:{moment.second:02d}.{millis:03d}Z"
    )


def encode_uri_component(text: str) -> str:
    """Percent-encode like JavaScript `encodeURIComponent`. Example: encode_uri_component("@a/b") -> "%40a%2Fb"."""
    return urllib.parse.quote(text, safe="!*'()")


def describe(value: Any) -> str:
    """Render a value compactly for error messages. Example: describe({"a": 1}) -> '{"a": 1}'."""
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        text = repr(value)
    return text if len(text) <= 120 else text[:117] + "..."


# --------------------------------------------------------------------------------------
# YAML `uses:` subset (identical algorithm to extractUses in eligible-upgrades.mjs)
# --------------------------------------------------------------------------------------


def _yaml_close(text: str, quote: str) -> int:
    """Index of the closing quote in `text` (which starts after the opening quote), or -1."""
    index = 0
    while index < len(text):
        char = text[index]
        if quote == '"' and char == "\\":
            index += 1
        elif char == quote and quote == "'" and text[index + 1:index + 2] == "'":
            index += 1
        elif char == quote:
            return index
        index += 1
    return -1


def _yaml_quoted(value: str) -> Optional[str]:
    """Decode the quoted scalar that starts `value`, or None when its closing quote is missing."""
    end = _yaml_close(value[1:], value[0])
    if end < 0:
        return None
    inner = value[1:end + 1]
    if value[0] == '"':
        return re.sub(r'\\(["\\/])', r"\1", inner)
    return inner.replace("''", "'")


def _yaml_value(raw: str) -> Dict[str, Any]:
    """Classify a YAML value after dropping anchors and tags.

    Types: empty, string (with `value`), block, flow (with `text`), open-quote (with `quote`),
    unreadable.
    """
    value = raw.strip()
    had_property = False
    match = YAML_PROPERTY.match(value)
    while match:
        value = value[match.end():]
        had_property = True
        match = YAML_PROPERTY.match(value)
    if not value or value[0] == "#":
        return {"type": "unreadable" if had_property else "empty"}
    if value[0] in "\"'":
        quoted = _yaml_quoted(value)
        if quoted is None:
            return {"type": "open-quote", "quote": value[0]}
        return {"type": "string", "value": quoted}
    if YAML_BLOCK_SCALAR.fullmatch(value):
        return {"type": "block"}
    if value[0] in "{[":
        return {"type": "flow", "text": value}
    if value[0] in YAML_UNREADABLE:
        return {"type": "unreadable"}
    plain = re.split(r"\s#", value, maxsplit=1)[0].strip()
    if not plain or YAML_NON_STRING.fullmatch(plain):
        return {"type": "empty"}
    return {"type": "string", "value": plain}


def _yaml_raw(raw: str) -> str:
    """Remove a trailing comment from a raw value."""
    return re.split(r"\s#", raw, maxsplit=1)[0].strip()


def _yaml_flow_line(line: str, depth: int, quote: Optional[str]) -> Tuple[int, Optional[str], str]:
    """Scan one flow-collection line: nesting depth, open quote and the line without comments."""
    clean = ""
    index = 0
    while index < len(line):
        char = line[index]
        if quote is not None:
            clean += char
            if quote == '"' and char == "\\":
                index += 1
                clean += line[index] if index < len(line) else ""
            elif char == quote and quote == "'" and line[index + 1:index + 2] == "'":
                index += 1
                clean += line[index]
            elif char == quote:
                quote = None
            index += 1
            continue
        if char == "#" and (index == 0 or line[index - 1].isspace()):
            break
        previous = clean.rstrip()[-1:]
        if char in "\"'" and (previous == "" or previous in "{[,:"):
            quote = char
        elif char in "{[":
            depth += 1
        elif char in "}]":
            depth -= 1
        clean += char
        index += 1
    return depth, quote, clean


def _yaml_emit(value: Dict[str, Any], raw: str, found: List[str]) -> None:
    """Emit what a `uses` value yields: strings as-is, anything unreadable as its raw text."""
    if value["type"] == "string":
        found.append(value["value"])
    elif value["type"] != "empty":
        found.append(_yaml_raw(raw))


class _FlowReader:
    """Reads a complete flow collection (`{...}` or `[...]`) and collects its `uses` values."""

    def __init__(self, text: str, found: List[str]) -> None:
        self.text = text
        self.found = found
        self.index = 0

    def skip(self) -> None:
        while self.index < len(self.text) and self.text[self.index].isspace():
            self.index += 1

    def scalar(self) -> Dict[str, Any]:
        text, start = self.text, self.index
        if text[self.index] in "\"'":
            end = _yaml_close(text[self.index + 1:], text[self.index])
            self.index = len(text) if end < 0 else self.index + end + 2
        else:
            self.read_plain()
        raw = text[start:self.index].strip()
        value = _yaml_value(raw)
        return {"raw": raw, "key": value.get("value"), "value": value}

    def read_plain(self) -> None:
        text = self.text
        while self.index < len(text) and text[self.index] not in ",[]{}":
            if text.startswith("${{", self.index):
                end = text.find("}}", self.index)
                self.index = len(text) if end < 0 else end + 2
            elif text[self.index] == ":" and (
                self.index + 1 >= len(text) or re.match(r"[\s,\]}]", text[self.index + 1])
            ):
                break
            else:
                self.index += 1

    def node(self) -> Dict[str, Any]:
        self.skip()
        text, start = self.text, self.index
        if self.index >= len(text) or text[self.index] not in "{[":
            return self.scalar() if self.index < len(text) else {"raw": "", "key": None, "value": {"type": "empty"}}
        close = "}" if text[self.index] == "{" else "]"
        self.index += 1
        while True:
            self.skip()
            if self.index >= len(text):
                break
            if text[self.index] == close:
                self.index += 1
                break
            if text[self.index] == ",":
                self.index += 1
                continue
            self.entry()
        raw = text[start:self.index]
        return {"raw": raw, "key": None, "value": {"type": "flow", "text": raw}}

    def entry(self) -> None:
        text, before = self.text, self.index
        key = self.node()
        self.skip()
        if self.index < len(text) and text[self.index] == ":":
            self.index += 1
            self.skip()
            if self.index >= len(text) or text[self.index] in ",]}":
                value = {"raw": "", "value": {"type": "empty"}}
            else:
                value = self.node()
            if key["key"] == "uses":
                _yaml_emit(value["value"], value["raw"], self.found)
        if self.index == before:
            self.index += 1


def _yaml_flow(text: str, found: List[str]) -> None:
    """Collect `uses` values from a complete flow collection."""
    _FlowReader(text, found).node()


def extract_uses(source: str) -> List[str]:
    """Extract `uses:` string values in document order without a YAML library.

    Supported subset: block-style `uses:` / `- uses:` and explicit `? uses` keys at any depth;
    plain, single/double quoted values with trailing `# comments`; `&anchor` and `!tag` prefixes
    (dropped); `{...}` / `[...]` flow collections, also across lines, scanned for `uses` keys;
    `|`/`>` block scalars and unclosed quoted scalars (their continuation lines are skipped, so
    their text is never read as a key). A `uses` value that cannot be read (alias `*x`, block
    scalar, flow collection, unclosed quote, bare anchor/tag, reserved indicator) is returned as
    its raw text so it surfaces as an unsupported declaration instead of disappearing.
    Not supported: multi-line plain scalars, alias resolution, YAML syntax validation.
    Example: extract_uses("steps:\\n  - uses: actions/checkout@v4 # pin") -> ["actions/checkout@v4"].
    """
    found: List[str] = []
    block_parent: Optional[int] = None
    quote: Optional[str] = None
    flow: Optional[Tuple[int, Optional[str], str]] = None
    explicit = False
    for raw in source.split("\n"):
        line = raw.rstrip("\r")
        if quote is not None:
            if _yaml_close(line, quote) >= 0:
                quote = None
            continue
        if flow is not None:
            depth, flow_quote, clean = _yaml_flow_line(line, flow[0], flow[1])
            flow = (depth, flow_quote, f"{flow[2]} {clean}")
            if depth > 0 or flow_quote is not None:
                continue
            _yaml_flow(flow[2], found)
            flow = None
            continue
        if block_parent is not None:
            if not line.strip() or len(line) - len(line.lstrip()) > block_parent:
                continue
            block_parent = None
        text = line.strip()
        if not text or text.startswith("#") or text in ("---", "..."):
            continue
        prefix = YAML_PREFIX.match(line).group(0)  # type: ignore[union-attr]
        column = len(prefix)
        rest = line[column:].rstrip()
        was_explicit, explicit = explicit, False
        if YAML_EXPLICIT_KEY.fullmatch(rest):
            explicit = True
            continue
        match = YAML_KEY.fullmatch(rest)
        explicit_value = YAML_EXPLICIT_VALUE.fullmatch(rest) if was_explicit else None
        is_uses = explicit_value is not None or (
            match is not None and match.group(1) in ("uses", '"uses"', "'uses'")
        )
        if explicit_value:
            value_text = explicit_value.group(1) or ""
        elif match:
            value_text = match.group(2) or ""
        else:
            value_text = rest
        value = _yaml_value(value_text)
        if is_uses:
            _yaml_emit(value, value_text, found)
        if value["type"] == "block":
            dash = prefix.rfind("-")
            block_parent = column if (match or explicit_value or dash < 0) else dash
        elif value["type"] == "open-quote":
            quote = value["quote"]
        elif value["type"] == "flow":
            depth, flow_quote, clean = _yaml_flow_line(value["text"], 0, None)
            flow = (depth, flow_quote, clean)
            if depth <= 0 and flow_quote is None:
                _yaml_flow(clean, found)
                flow = None
    if flow is not None:
        _yaml_flow(flow[2], found)
    return found


# --------------------------------------------------------------------------------------
# Discovery
# --------------------------------------------------------------------------------------

_MISSING = object()


def _same_declaration(left: Any, right: Any) -> bool:
    """Mirror JavaScript `===` for JSON scalars; containers are never identical."""
    if left is _MISSING or right is _MISSING:
        return False
    if isinstance(left, (dict, list)) or isinstance(right, (dict, list)):
        return False
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    return type(left) is type(right) and left == right


def _section(manifest: Any, section: str) -> Dict[str, Any]:
    if not isinstance(manifest, dict):
        return {}
    value = manifest.get(section)
    return value if isinstance(value, dict) else {}


def _manifest_coverage(spec: Any, exact: bool) -> str:
    if exact:
        return "exact"
    if not isinstance(spec, str):
        return "unsupported"
    if RANGE_SPEC.fullmatch(spec):
        return "range"
    if PREVIEW_VERSION.search(spec) or DIST_TAG.fullmatch(spec):
        return "preview-or-tag"
    return "unsupported"


def _manifest_row(
    path: str, section: str, name: str, declaration: Any, previous: Any, resolved: Mapping[str, Any]
) -> Row:
    row: Row = {
        "kind": "npm",
        "path": path,
        "section": section,
        "name": name,
        "declaration": declaration,
        "previous": None if previous is _MISSING else previous,
    }
    row["id"] = f"{path}#{section}:{name}"
    alias = ALIAS.fullmatch(declaration) if isinstance(declaration, str) else None
    row["package"] = alias.group(1) if alias else name
    row["alias"] = alias is not None
    spec = alias.group(2) if alias else declaration
    exact = is_stable(spec)
    row["current"] = normalize(spec) if exact else resolved.get(row["id"])
    row["coverage"] = _manifest_coverage(spec, exact)
    if row["current"] and not is_stable(row["current"]):
        row["coverage"] = "preview-or-tag"
        row["current"] = None
    if row["current"] and row["coverage"] == "range" and not satisfies_range(row["current"], spec):
        row["resolution_error"] = f"Resolved version {row['current']} does not satisfy {spec}"
        row["current"] = None
    return row


def discover_manifest(
    path: str, before: Any, after: Any, resolved: Optional[Mapping[str, Any]] = None
) -> List[Row]:
    """Discover changed manifest declarations structurally, keeping workspace/section identity.

    Example: discover_manifest("package.json", {}, {"dependencies": {"pkg": "1.0.0"}}) yields one row.
    """
    resolved = resolved or {}
    rows: List[Row] = []
    for section in SECTIONS:
        old = _section(before, section)
        for name, declaration in _section(after, section).items():
            previous = old.get(name, _MISSING)
            if _same_declaration(previous, declaration):
                continue
            rows.append(_manifest_row(path, section, name, declaration, previous, resolved))
    return rows


def _action_current(pin: Optional[str], comment: Optional[str]) -> Optional[str]:
    if pin and is_stable(pin):
        return pin
    if pin and SHA40.fullmatch(pin):
        return comment
    return None


def discover_actions(path: str, before: str, after: str) -> List[Row]:
    """Discover action declarations, including unsupported pins (uses the `extract_uses` subset).

    Example: discover_actions("ci.yml", "", "steps:\\n  - uses: owner/action@v1.2.3") yields one row.
    """
    old = extract_uses(before or "")
    declarations = extract_uses(after or "")
    lines = (after or "").split("\n")
    rows: List[Row] = []
    for index, declaration in enumerate(declarations):
        if declaration in old:
            old.remove(declaration)
            continue
        match = ACTION_USE.fullmatch(declaration)
        pin = match.group(2) if match else None
        # Without source locations, repeated declarations or ambiguous lines cannot supply evidence.
        matching_lines = [text for text in lines if declaration in text]
        line = (
            matching_lines[0]
            if declarations.count(declaration) == 1 and len(matching_lines) == 1
            and extract_uses(matching_lines[0]) == [declaration]
            else None
        )
        comment_match = VERSION_COMMENT.search(line) if line else None
        current = _action_current(pin, comment_match.group(1) if comment_match else None)
        row: Row = {
            "kind": "action",
            "path": path,
            "section": "uses",
            "name": match.group(1) if match else declaration,
            "declaration": declaration,
            "id": f"{path}#uses:{index}:{declaration}",
            "current": current,
            "coverage": "exact" if current else "unsupported",
        }
        if pin is not None:
            row["pin"] = pin
        rows.append(row)
    return rows


def _decode(data: Optional[bytes]) -> str:
    return (data or b"").decode("utf-8", errors="replace")


def make_git_runner(
    cwd: Optional[Any] = None, env: Optional[Mapping[str, str]] = None
) -> GitRunner:
    """Build the default git runner: `runner(["rev-parse", "HEAD"])` returns stdout or raises GitError.

    Example: make_git_runner(cwd="/repo")(["rev-parse", "HEAD"]).
    """

    def run_git(args: Sequence[str]) -> str:
        command = " ".join(args)
        try:
            completed = subprocess.run(
                ["git", *args], cwd=cwd, env=env, capture_output=True, check=False
            )
        except OSError as error:
            raise GitError(f"(git {command}): expected git to run | received: {error}") from error
        if completed.returncode != 0:
            raise GitError(
                f"(git {command}): expected exit code 0 | received: exit {completed.returncode}: "
                f"{_decode(completed.stderr).strip()}"
            )
        return _decode(completed.stdout)

    return run_git


def _parse_changes(records: Sequence[str]) -> List[Tuple[str, str]]:
    changes: List[Tuple[str, str]] = []
    index = 0
    while index < len(records):
        status, first = records[index], records[index + 1]
        index += 2
        path = first
        if status[0] in "RC":
            path = records[index]
            index += 1
        changes.append((path, first if status.startswith("R") else path))
    return changes


def discover_changes(
    base: str,
    head: str,
    resolved: Optional[Mapping[str, Any]] = None,
    run_git: Optional[GitRunner] = None,
) -> Result:
    """Read changes relative to the merge base without modifying the repository.

    Refs are resolved once to commit ids, so a moving branch cannot change the inventory.
    Example: discover_changes("origin/main", "HEAD") -> {"base": ..., "rows": [...], ...}.
    """
    git_runner = run_git or make_git_runner()

    def git(*args: str) -> str:
        return git_runner(list(args))

    base_tip = git("rev-parse", "--verify", "--end-of-options", f"{base}^{{commit}}").strip()
    head_tip = git("rev-parse", "--verify", "--end-of-options", f"{head}^{{commit}}").strip()
    start = git("merge-base", base_tip, head_tip).strip()
    records = git(
        "diff", "--name-status", "--find-renames", "--find-copies", "--diff-filter=AMRC",
        "-z", start, head_tip,
    ).split("\0")
    changes = _parse_changes([record for record in records if record])

    def read(ref: str, path: str, optional: bool = False) -> str:
        try:
            return git("show", f"{ref}:{path}")
        except GitError:
            if optional and not git("ls-tree", ref, "--", path).strip():
                return ""
            raise

    rows: List[Row] = []
    uncovered: List[Dict[str, str]] = []
    for path, old_path in changes:
        if MANIFEST_PATH.search(path):
            before = parse_json(read(start, old_path, True) or "{}")
            rows.extend(discover_manifest(path, before, parse_json(read(head_tip, path)), resolved))
        elif YAML_PATH.search(path):
            rows.extend(discover_actions(path, read(start, old_path, True), read(head_tip, path)))
        elif UNCOVERED_PATH.search(path):
            uncovered.append({"path": path, "coverage": "unsupported-ecosystem"})
    return {"base": start, "base_tip": base_tip, "head": head_tip, "rows": rows, "uncovered": uncovered}


# --------------------------------------------------------------------------------------
# Evidence transport
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class FetchResponse:
    """HTTP response consumed by `create_evidence`: a status code and a JSON-decoding method."""

    status: int
    body: bytes = b""

    def json(self) -> Any:
        """Decode the body as strict JSON. Example: FetchResponse(200, b"{}").json() -> {}."""
        return parse_json(self.body.decode("utf-8"))


@dataclass(frozen=True)
class CommandResult:
    """Outcome of an external command: exit code and decoded output."""

    returncode: int
    stdout: str = ""
    stderr: str = ""


Fetcher = Callable[[str, float], Any]
CommandRunner = Callable[[Sequence[str]], Any]


def make_url_fetcher(urlopen: Optional[Callable[..., Any]] = None) -> Fetcher:
    """Build the default fetcher; non-2xx statuses return a response instead of raising.

    Example: make_url_fetcher()("https://registry.npmjs.org/typescript", 30).status.
    """
    opener = urlopen or urllib.request.urlopen

    def fetch(url: str, timeout: float) -> FetchResponse:
        try:
            with opener(url, timeout=timeout) as response:
                return FetchResponse(response.status, response.read())
        except urllib.error.HTTPError as error:
            error.close()
            return FetchResponse(error.code)

    return fetch


def run_command(args: Sequence[str]) -> CommandResult:
    """Run an argument list without a shell and capture decoded output. Example: run_command(["git", "--version"])."""
    completed = subprocess.run(
        list(args), capture_output=True, timeout=GH_TIMEOUT_SECONDS, check=False
    )
    return CommandResult(completed.returncode, _decode(completed.stdout), _decode(completed.stderr))


class Evidence:
    """Registry and GitHub evidence source; every lookup returns a status dict, never raises.

    Statuses: `ok` (with `data`), `not_found` (HTTP 404) and `error` (with `reason`).
    """

    def __init__(self, fetcher: Fetcher, run: CommandRunner) -> None:
        self._fetcher = fetcher
        self._run = run

    def _request(self, url: str) -> Result:
        try:
            response = self._fetcher(url, FETCH_TIMEOUT_SECONDS)
            if response.status == 404:
                return {"status": "not_found"}
            if not 200 <= response.status < 300:
                return {"status": "error", "reason": f"HTTP {response.status}"}
            return {"status": "ok", "data": response.json()}
        except (OSError, ValueError, http.client.HTTPException) as error:
            return {"status": "error", "reason": str(error)}

    def npm(self, name: str) -> Result:
        """Fetch npm registry metadata. Example: create_evidence().npm("typescript")."""
        return self._request(f"https://registry.npmjs.org/{encode_uri_component(name)}")

    def github(self, endpoint: str) -> Result:
        """Call `gh api --include`; 404 is `not_found`. Example: create_evidence().github("repos/o/r/releases")."""
        try:
            result = self._run(["gh", "api", "--include", endpoint])
        except (OSError, subprocess.SubprocessError) as error:
            return {"status": "error", "reason": str(error)}
        output = (result.stdout or "").replace("\r\n", "\n")
        status = HTTP_STATUS.search(output)
        if status and status.group(1) == "404":
            return {"status": "not_found"}
        if result.returncode != 0:
            reason = (result.stderr or "").strip() or f"exit {result.returncode}"
            return {"status": "error", "reason": reason}
        try:
            return {"status": "ok", "data": parse_json(output[output.find("\n\n") + 2:])}
        except ValueError as error:
            return {"status": "error", "reason": f"Invalid GitHub JSON: {error}"}


def create_evidence(
    fetcher: Optional[Fetcher] = None, run: Optional[CommandRunner] = None
) -> Evidence:
    """Create the evidence source with injectable network and `gh` runners.

    `fetcher(url, timeout)` returns an object with `status` and `json()`; `run(args)` returns an
    object with `returncode`, `stdout` and `stderr`. Example: create_evidence().npm("typescript").
    """
    return Evidence(fetcher or make_url_fetcher(), run or run_command)


# --------------------------------------------------------------------------------------
# Assessment
# --------------------------------------------------------------------------------------


def _repo_of(metadata: Mapping[str, Any]) -> Optional[str]:
    repository = metadata.get("repository")
    url = repository if isinstance(repository, str) else (
        repository.get("url") if isinstance(repository, dict) else ""
    )
    match = GITHUB_REPO.search(url if isinstance(url, str) else "")
    return match.group(1) if match else None


def _unknown(reason: Any) -> Result:
    return {"status": "unknown", "reason": reason}


def _release_check(release: Any, published: Any, cutoff: float) -> Result:
    if (
        not isinstance(release, dict)
        or not isinstance(release.get("draft"), bool)
        or not isinstance(release.get("prerelease"), bool)
    ):
        return _unknown("Missing release flags")
    if release["draft"] or release["prerelease"]:
        return {"status": "ineligible", "reason": "Draft or prerelease GitHub release"}
    time_ms = parse_timestamp(published)
    release_ms = parse_timestamp(release.get("published_at"))
    if time_ms is None or release_ms is None:
        return _unknown("Missing or invalid publication time")
    if time_ms > cutoff or release_ms > cutoff:
        return {
            "status": "ineligible",
            "reason": "Publication younger than cutoff",
            "published": published,
            "release_published": release["published_at"],
        }
    result: Result = {
        "status": "eligible",
        "published": published,
        "release_published": release["published_at"],
    }
    if "tag_name" in release:
        result["tag"] = release["tag_name"]
    return result


def _npm_release(evidence: Any, repo: Optional[str], name: str, version: str) -> Result:
    if not repo:
        return _unknown("No GitHub repository metadata")
    short = name.split("/")[-1]
    tags = (f"v{version}", version, f"{name}@{version}", f"{short}@{version}", f"{short}-v{version}")
    for tag in dict.fromkeys(tags):
        result = evidence.github(f"repos/{repo}/releases/tags/{encode_uri_component(tag)}")
        if result["status"] == "error":
            return _unknown(result.get("reason"))
        if result["status"] == "ok":
            return {"status": "ok", "release": result["data"]}
    return {
        "status": "ineligible",
        "reason": "No GitHub release (all supported tag patterns returned 404)",
    }


def _assess_npm(result: Result, row: Row, evidence: Any, cutoff: float) -> bool:
    """Fill npm evidence; False when evidence is unavailable and the summary must be skipped."""
    metadata = evidence.npm(row["package"])
    if metadata["status"] != "ok":
        result["current_evidence"] = _unknown(
            "Registry package not found" if metadata["status"] == "not_found" else metadata.get("reason")
        )
        return False
    data = metadata["data"]
    registry_versions = data.get("versions") if isinstance(data, dict) else None
    if not isinstance(registry_versions, dict):
        result["current_evidence"] = _unknown("Missing registry versions")
        return False
    newer = sorted(
        (v for v in registry_versions if is_stable(v) and compare(v, row["current"]) > 0),
        key=lambda v: version_key(v),  # type: ignore[arg-type,return-value]
        reverse=True,
    )
    result["preview_versions"] = [v for v in registry_versions if PREVIEW_VERSION.search(v)]
    time_value = data.get("time")
    times: Dict[str, Any] = time_value if isinstance(time_value, dict) else {}

    def check(version: str) -> Result:
        exact = normalize(version)
        if exact not in registry_versions:
            return _unknown("Exact version absent from registry versions")
        release = _npm_release(evidence, _repo_of(data), row["package"], exact)
        if release["status"] != "ok":
            return release
        return _release_check(release["release"], times.get(exact), cutoff)

    result["current_evidence"] = check(row["current"])
    result["newer_stable_count"] = len(newer)
    for version in newer:
        candidate = {"version": version, **check(version)}
        result["candidates"].append(candidate)
        if candidate["status"] == "eligible":
            break
    return True


def _list_releases(result: Result, row: Row, evidence: Any) -> Optional[List[Any]]:
    releases: List[Any] = []
    page = 1
    while True:
        response = evidence.github(f"repos/{row['name']}/releases?per_page=100&page={page}")
        if response["status"] != "ok" or not isinstance(response.get("data"), list):
            reason = response.get("reason")
            result["current_evidence"] = _unknown(
                "Incomplete Actions release listing" if reason is None else reason
            )
            return None
        releases.extend(response["data"])
        if len(response["data"]) < 100:
            return releases
        page += 1


def _stable_tag(release: Any) -> bool:
    return isinstance(release, dict) and is_stable(release.get("tag_name"))


def _assess_actions(result: Result, row: Row, evidence: Any, cutoff: float) -> bool:
    """Fill GitHub Actions evidence; False when evidence is unavailable."""
    releases = _list_releases(result, row, evidence)
    if releases is None:
        return False
    pin = row.get("pin")
    if isinstance(pin, str) and SHA40.fullmatch(pin):
        ref = evidence.github(f"repos/{row['name']}/commits/{encode_uri_component(row['current'])}")
        sha = ref["data"].get("sha") if ref["status"] == "ok" and isinstance(ref["data"], dict) else None
        if ref["status"] != "ok" or sha != pin:
            reason = ref.get("reason")
            result["current_evidence"] = _unknown(
                "Pinned SHA does not match version tag" if reason is None else reason
            )
            return False
    current = next(
        (r for r in releases if _stable_tag(r) and compare(r["tag_name"], row["current"]) == 0), None
    )
    result["current_evidence"] = _release_check(
        current, current.get("published_at") if current else None, cutoff
    )
    major = version_key(row["current"])[0]  # type: ignore[index]
    newer = sorted(
        (
            r for r in releases
            if _stable_tag(r)
            and version_key(r["tag_name"])[0] == major  # type: ignore[index]
            and compare(r["tag_name"], row["current"]) > 0
        ),
        key=lambda r: version_key(r["tag_name"]),  # type: ignore[arg-type,return-value]
        reverse=True,
    )
    for release in newer:
        result["candidates"].append(
            {"version": release["tag_name"], **_release_check(release, release.get("published_at"), cutoff)}
        )
    return True


def _summarize(result: Result) -> None:
    candidates = result["candidates"]
    eligible = next((c for c in candidates if c["status"] == "eligible"), None)
    higher_unknown = any(
        c["status"] == "unknown" and (eligible is None or compare(c["version"], eligible["version"]) > 0)
        for c in candidates
    )
    any_unknown = result["current_evidence"]["status"] == "unknown" or any(
        c["status"] == "unknown" for c in candidates
    )
    result["completeness"] = "unknown" if any_unknown else "complete"
    result["eligible"] = eligible["version"] if eligible else None
    if higher_unknown:
        result["recommendation"] = "unknown"
    elif eligible:
        result["recommendation"] = "eligible-newer-version"
    elif candidates:
        result["recommendation"] = "no-eligible-newer-version"
    else:
        result["recommendation"] = "no-newer-stable-version"


def assess(row: Row, evidence: Any, cutoff: float) -> Result:
    """Assess current and candidate versions with injected evidence and a cutoff in epoch ms.

    `evidence` provides `npm(name)` and `github(endpoint)` returning status dicts. Unlike the
    JavaScript version the calls are synchronous. Example:
    assess(row, create_evidence(), time.time() * 1000 - 3 * 86400000).
    """
    result: Result = {
        **row,
        "current_evidence": _unknown("No exact stable version to assess"),
        "candidates": [],
        "completeness": "unknown",
        "recommendation": "unknown",
    }
    if not row.get("current") or row.get("coverage") not in ("exact", "range"):
        if row.get("resolution_error"):
            result["current_evidence"] = _unknown(row["resolution_error"])
        return result
    assess_source = _assess_npm if row.get("kind") == "npm" else _assess_actions
    if assess_source(result, row, evidence, cutoff):
        _summarize(result)
    return result


# --------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------

USAGE = "--base REF | --head REF | --min-days NUMBER | --resolved FILE | --json"


def parse_arguments(args: Sequence[str]) -> Dict[str, Any]:
    """Parse explicit CLI options only; raises ValueError naming the offending argument.

    Example: parse_arguments(["--base", "main", "--json"]) -> {"base": "main", ..., "json": True}.
    """
    options: Dict[str, Any] = {"base": "origin/main", "head": "HEAD", "min-days": "3"}
    index = 0
    while index < len(args):
        flag = args[index]
        has_value = index + 1 < len(args) and bool(args[index + 1]) and not args[index + 1].startswith("--")
        if flag == "--json":
            options["json"] = True
        elif flag in VALUE_FLAGS and has_value:
            index += 1
            options[flag[2:]] = args[index]
        else:
            suffix = " without a value" if flag in VALUE_FLAGS else ""
            raise ValueError(f"(arguments): expected {USAGE} | received: {flag}{suffix}")
        index += 1
    return options


def load_resolved(path: Optional[str]) -> Dict[str, str]:
    """Load and validate the `--resolved` mapping of declaration IDs to exact versions.

    Example: load_resolved(None) -> {}.
    """
    if not path:
        return {}
    try:
        resolved = parse_json(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError(f"(--resolved): expected readable JSON file | received: {path}: {error}") from error
    if not isinstance(resolved, dict) or any(not isinstance(v, str) for v in resolved.values()):
        raise ValueError(
            "(--resolved): expected object of declaration IDs to exact version strings "
            f"| received: {describe(resolved)}"
        )
    return resolved


def _print_text_report(report: Result, out: Callable[[str], None]) -> None:
    out(f"Cutoff: {report['cutoff']}")
    for row in report["rows"]:
        current = "unresolved" if row["current"] is None else row["current"]
        eligible = f" {row['eligible']}" if row.get("eligible") else ""
        out(
            f"{row['id']}: {row['declaration']}; current={current} "
            f"({row['current_evidence']['status']}); {row['recommendation']}{eligible}; "
            f"coverage={row['coverage']}; completeness={row['completeness']}"
        )
    for item in report["uncovered"]:
        out(f"{item['path']}: {item['coverage']}")


def main(
    args: Optional[Sequence[str]] = None,
    *,
    evidence: Any = None,
    run_git: Optional[GitRunner] = None,
    now_ms: Optional[Callable[[], int]] = None,
    out: Callable[[str], None] = print,
) -> int:
    """Run the CLI and return the exit code (0 complete, 2 unknown evidence or uncovered files).

    Invalid options raise ValueError (the `cli` wrapper turns that into exit 1). Evidence, git and
    the clock are injectable for tests. Example: main(["--base", "origin/main", "--json"]).
    """
    options = parse_arguments(sys.argv[1:] if args is None else args)
    days = js_number(options["min-days"])
    if not math.isfinite(days) or days < 0:
        raise ValueError(
            f"(--min-days): expected finite nonnegative number | received: {options['min-days']}"
        )
    resolved = load_resolved(options.get("resolved"))
    inventory = discover_changes(options["base"], options["head"], resolved, run_git)
    now = now_ms() if now_ms else int(time.time() * 1000)
    cutoff = math.trunc(now - days * DAY_MS)
    source = evidence or create_evidence()
    rows = [assess(row, source, cutoff) for row in inventory["rows"]]
    report: Result = {**inventory, "cutoff": format_iso(cutoff), "rows": rows}
    if options.get("json"):
        out(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        _print_text_report(report, out)
    incomplete = any(
        row["completeness"] == "unknown" or row["current_evidence"]["status"] != "eligible"
        for row in rows
    )
    return 2 if incomplete or inventory["uncovered"] else 0


def cli(argv: Optional[Sequence[str]] = None) -> int:
    """Process entrypoint: run `main`, print any error to stderr and return exit code 1.

    Example: sys.exit(cli(["--json"])).
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8")
    try:
        return main(argv)
    except Exception as error:  # noqa: BLE001 - parity with the JS entrypoint: any failure is exit 1
        print(error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(cli(sys.argv[1:]))
