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
// Bash has no structured file_path — this only pattern-matches the command
// text for the protected path combined with a write-shaped operator/command
// (including symlink creation itself, `ln`), which is a heuristic, not a
// shell parser: it will not catch every way Bash could reach
// app/src/core/** (e.g. a path built from a variable, or writing through a
// symlink created in an earlier, separate command). It exists to raise the
// bar, not to replace the rule or a human's judgment.
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const PROTECTED_PREFIX = "app/src/core/";
const PROTECTED_MENTION = /app[\\/]src[\\/]core([\\/]|\b)/;
const WRITE_SHAPED = new RegExp(
  [
    // shell redirection: `>`/`>>` preceded by start-of-string/whitespace and
    // followed by a path-like token — not just any `>`, which would also
    // match the closing bracket of an email like `<name@host>` (e.g. in a
    // Co-Authored-By trailer).
    "(?:^|\\s)>>?\\s*[\\w./~-]",
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
  if (typeof command === "string" && PROTECTED_MENTION.test(command) && WRITE_SHAPED.test(command)) {
    block(`this shell command appears to write into or symlink app/src/core/**`);
  }
  process.exit(0);
}

const filePath = payload?.tool_input?.file_path;
if (!filePath) process.exit(0);

const canonicalCwd = canonicalize(resolve(cwd));
const canonicalTarget = canonicalize(resolve(cwd, filePath));
const relPath = relative(canonicalCwd, canonicalTarget).split("\\").join("/");

if (relPath === PROTECTED_PREFIX.slice(0, -1) || relPath.startsWith(PROTECTED_PREFIX)) {
  block(`"${relPath}" is under app/src/core/**`);
}

process.exit(0);
