#!/usr/bin/env node
// PreToolUse hook (matcher: Edit|Write|Bash). Blocks writes under
// app/src/core/**, the platform-shared, protected zone (see
// .claude/rules/do-not-touch.md). Exit code 2 = block; Claude Code shows
// the agent whatever is written to stderr.
//
// Edit/Write: the target path is canonicalized through realpath on its
// closest existing ancestor before checking the prefix, so a symlink whose
// name isn't literally "core" (e.g. app/src/core-link -> app/src/core)
// can't be used to write into the protected zone under a different name.
//
// Bash has no structured file_path. This checks two things: whether the
// command text literally mentions app/src/core, and — to catch a symlink
// referenced by an unrelated name, e.g. `p=core-link; printf x >
// "$p/log.ts"` — whether any bare path-like token in the command (including
// the right-hand side of a `VAR=value` assignment) resolves, on the real
// filesystem, into app/src/core. Both checks only run when the command also
// looks write-shaped. This is still a heuristic, not a shell parser: it
// cannot evaluate command substitution (`$(...)`), string-built paths, or
// anything that doesn't exist on disk yet at check time. It raises the bar;
// it doesn't replace the rule or a human's judgment, and closing the gap
// completely would mean either a real shell sandbox or blocking Bash writes
// outright, both disproportionate to what this hook is for.
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const PROTECTED_PREFIX = "app/src/core/";
const PROTECTED_MENTION = /app[\\/]src[\\/]core([\\/]|\b)/;
const WRITE_SHAPED = new RegExp(
  [
    // shell redirection: `>`/`>>` preceded by start-of-string/whitespace —
    // not just any `>`, which would also match the closing bracket of an
    // email like `<name@host>` (e.g. in a Co-Authored-By trailer; there the
    // `>` always directly follows the address, never whitespace). Not
    // requiring anything about what follows `>` on purpose: a quoted or
    // variable-based target (`> "$file"`, `> $OUT`) is exactly the shape
    // this needs to catch, not just a bare word.
    "(?:^|\\s)>>?(?!&)",
    "\\b(ln|mv|cp|rm|rmdir|touch|tee|dd|truncate|install|rsync|chmod|chown)\\b",
    "\\bsed\\b[^\\n]*-i\\b",
    "\\bgit\\s+(checkout|apply|mv|restore|clean|rm)\\b",
    "\\b(writeFileSync|appendFileSync|fs\\.write|symlinkSync|fs\\.symlink)\\b",
    "open\\([^)]*['\"]a?w['\"]",
  ].join("|"),
);

function readStdin() {
  return new Promise((resolvePromise) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolvePromise(data));
  });
}

function block(reason) {
  console.error(
    `Blocked: ${reason}, the protected platform core ` +
      `(see .claude/rules/do-not-touch.md). Core changes go through a separate PR ` +
      `reviewed by the platform team. Describe what needs to change in core and why, ` +
      `instead of editing it here.`,
  );
  process.exit(2);
}

// Resolves symlinks in whatever prefix of `absPath` already exists, then
// re-appends the not-yet-existing tail literally (a nonexistent path can't
// itself be a symlink). This canonicalizes e.g. app/src/core-link/new.ts to
// its real target even though new.ts doesn't exist yet.
function canonicalize(absPath) {
  const tail = [];
  let dir = absPath;
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) return absPath; // hit the filesystem root, give up
    tail.unshift(basename(dir));
    dir = parent;
  }
  try {
    dir = realpathSync(dir);
  } catch {
    return absPath; // fall back to the lexical path if realpath fails
  }
  return tail.length ? join(dir, ...tail) : dir;
}

function isUnderProtected(absPath, canonicalCwd) {
  const relPath = relative(canonicalCwd, canonicalize(absPath)).split("\\").join("/");
  return relPath === PROTECTED_PREFIX.slice(0, -1) || relPath.startsWith(PROTECTED_PREFIX);
}

// Pulls out bare, literal path-like tokens from a shell command: plain words
// (no shell metacharacters we can't safely evaluate, like `$` or `{}`) and
// the right-hand side of simple `VAR=value` assignments. Deliberately
// conservative — anything containing `$`, quotes we can't strip cleanly, or
// command substitution is skipped rather than guessed at.
function extractCandidatePaths(command) {
  const candidates = new Set();
  for (const raw of command.split(/[\s;&|]+/)) {
    const token = raw.replace(/^['"]|['"]$/g, "");
    const assignment = /^[A-Za-z_][A-Za-z0-9_]*=(.+)$/.exec(token);
    const candidate = assignment ? assignment[1].replace(/^['"]|['"]$/g, "") : token;
    if (/^[\w./~-]+$/.test(candidate)) candidates.add(candidate);
  }
  return candidates;
}

const raw = await readStdin();

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0); // malformed input: fail open, don't block on our own bug
}

const cwd = payload?.cwd ?? process.cwd();

if (payload?.tool_name === "Bash") {
  const command = payload?.tool_input?.command;
  if (typeof command === "string" && WRITE_SHAPED.test(command)) {
    if (PROTECTED_MENTION.test(command)) {
      block(`this shell command appears to write into or symlink app/src/core/**`);
    }
    const canonicalCwd = canonicalize(resolve(cwd));
    for (const candidate of extractCandidatePaths(command)) {
      const abs = resolve(cwd, candidate);
      if (existsSync(abs) && isUnderProtected(abs, canonicalCwd)) {
        block(`this shell command references "${candidate}", which resolves into app/src/core/**`);
      }
    }
  }
  process.exit(0);
}

const filePath = payload?.tool_input?.file_path;
if (!filePath) process.exit(0);

const canonicalCwd = canonicalize(resolve(cwd));
if (isUnderProtected(resolve(cwd, filePath), canonicalCwd)) {
  block(`"${relative(canonicalCwd, canonicalize(resolve(cwd, filePath))).split("\\").join("/")}" is under app/src/core/**`);
}

process.exit(0);
