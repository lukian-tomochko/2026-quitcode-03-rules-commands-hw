#!/usr/bin/env node
// PreToolUse hook (matcher: Edit|Write|Bash). Blocks writes under
// app/src/core/**, the platform-shared, protected zone (see
// .claude/rules/do-not-touch.md). Exit code 2 = block; Claude Code shows
// the agent whatever is written to stderr.
//
// Edit/Write are checked exactly, via tool_input.file_path. Bash has no
// structured file_path — this only pattern-matches the command text for the
// protected path combined with a write-shaped operator/command, which is a
// heuristic, not a shell parser: it will not catch every way Bash could
// write to app/src/core/** (e.g. an indirect path built from variables).
// It exists to raise the bar, not to replace the rule or a human's judgment.
import { relative, resolve } from "node:path";

const PROTECTED_PREFIX = "app/src/core/";
const PROTECTED_MENTION = /app[\\/]src[\\/]core([\\/]|\b)/;
const WRITE_SHAPED = new RegExp(
  [
    // shell redirection: `>`/`>>` preceded by start-of-string/whitespace and
    // followed by a path-like token — not just any `>`, which would also
    // match the closing bracket of an email like `<name@host>` (e.g. in a
    // Co-Authored-By trailer).
    "(?:^|\\s)>>?\\s*[\\w./~-]",
    "\\b(mv|cp|rm|rmdir|touch|tee|dd|truncate|install|rsync|chmod|chown)\\b",
    "\\bsed\\b[^\\n]*-i\\b",
    "\\bgit\\s+(checkout|apply|mv|restore|clean|rm)\\b",
    "\\b(writeFileSync|appendFileSync|fs\\.write)\\b",
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
    block(`this shell command appears to write into app/src/core/**`);
  }
  process.exit(0);
}

const filePath = payload?.tool_input?.file_path;
if (!filePath) process.exit(0);

const relPath = relative(resolve(cwd), resolve(cwd, filePath)).split("\\").join("/");

if (relPath === PROTECTED_PREFIX.slice(0, -1) || relPath.startsWith(PROTECTED_PREFIX)) {
  block(`"${relPath}" is under app/src/core/**`);
}

process.exit(0);
