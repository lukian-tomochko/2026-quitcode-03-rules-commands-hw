#!/usr/bin/env node
// PreToolUse hook (matcher: Edit|Write). Blocks any edit/write under
// app/src/core/**, the platform-shared, protected zone (see
// .claude/rules/do-not-touch.md). Exit code 2 = block; Claude Code shows
// the agent whatever is written to stderr.
import { relative, resolve } from "node:path";

const PROTECTED_PREFIX = "app/src/core/";

function readStdin() {
  return new Promise((resolvePromise) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolvePromise(data));
  });
}

const raw = await readStdin();

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0); // malformed input: fail open, don't block on our own bug
}

const filePath = payload?.tool_input?.file_path;
if (!filePath) process.exit(0);

const cwd = payload.cwd ?? process.cwd();
const relPath = relative(resolve(cwd), resolve(cwd, filePath)).split("\\").join("/");

if (relPath === PROTECTED_PREFIX.slice(0, -1) || relPath.startsWith(PROTECTED_PREFIX)) {
  console.error(
    `Blocked: "${relPath}" is under app/src/core/**, the protected platform core ` +
      `(see .claude/rules/do-not-touch.md). Core changes go through a separate PR ` +
      `reviewed by the platform team. Describe what needs to change in core and why, ` +
      `instead of editing it here.`,
  );
  process.exit(2);
}

process.exit(0);
