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
// Bash: there is no reliable way to know a shell command's actual write
// target from its text alone — after three rounds of trying (a literal
// "app/src/core" mention, then resolving bare/variable-assigned tokens
// through the real filesystem), the last remaining gap was a target built by
// concatenating a variable with more literal text, e.g.
// `d=app/src; printf x > "$d/core/blocked.ts"` — no fixed set of regexes can
// bound every way a shell can build a string. Rather than add another one,
// every write-shaped Bash command is blocked outright, regardless of what it
// mentions or resolves to: file changes go through Edit or Write instead,
// which report a structured, exact target this hook can always verify.
// Closing this any other way would mean a real shell sandbox that actually
// performs the expansion and checks the resulting target, which is out of
// proportion to what this hook is for.
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const PROTECTED_PREFIX = "app/src/core/";
const WRITE_SHAPED = new RegExp(
  [
    // shell redirection: `>`/`>>`, excluding the specific shape of an email
    // closing an angle-bracket (e.g. `<noreply@anthropic.com>` in a
    // Co-Authored-By trailer) rather than requiring whitespace before it —
    // bash accepts redirection with no space at all (`cmd>file`, `2>file`).
    "(?<!<[\\w.+-]+@[\\w.-]+)>>?(?!&)",
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
    block(
      `this shell command looks like it writes, renames, or symlinks a file, and its actual ` +
        `target can't be verified from its text — use Edit or Write for file changes instead of Bash`,
    );
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
