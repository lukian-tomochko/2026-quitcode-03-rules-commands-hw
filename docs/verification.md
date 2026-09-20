# Verification (Task B, C, and bonus E)

> Only what actually happened in the session goes here: quotes, numbers, file names.

## Task B — does the tool see AGENTS.md

- Tool and version: Claude Code (Sonnet 5, `claude-sonnet-5`)
- How verified: opened a **new** top-level session in this repo and, without
  opening any files, asked it to quote exactly what it has in context from
  `CLAUDE.md` and `AGENTS.md`.
- Before the fix: `CLAUDE.md` contained a markdown link
  `[AGENTS.md](./AGENTS.md)`. A fresh session showed only that link text; it
  explicitly reported "AGENTS.md itself is referenced but not loaded... I
  can't summarize its actual content without reading it." The link was not
  an import.
- After the fix: `CLAUDE.md` was changed to a single import line `@AGENTS.md`.
  A new session then quoted the **full content** of `AGENTS.md` (project
  description, commands, map, the 5–7 rule pointers, pre-commit check)
  verbatim, unprompted, without opening either file with a tool — confirming
  the import actually pulls the file into context at session start, the same
  way `CLAUDE.md` itself loads.
- Result: `@AGENTS.md` import works as documented; the plain markdown link
  did not.
- Cross-check via `/context`: in the same session, the Memory Files table
  reported `CLAUDE.md` at 24 tokens and `AGENTS.md` at 700 tokens (plus
  `.claude/rules/do-not-touch.md` at 436 tokens, loaded separately as a
  project rule). 24 tokens is consistent with just the two-line
  `# CLAUDE.md` / `@AGENTS.md` file; 700 tokens is consistent with the full
  `AGENTS.md` body — confirming the import loaded the content rather than a
  reference to it.
- `/context` category total: **Memory files — 1.2k tokens, 0.1%** of the
  context window (`CLAUDE.md` + `AGENTS.md` + `.claude/rules/do-not-touch.md`
  combined).

## Task C — command runs

### `/analyze-error`

- Invocation: `/analyze-error materials/error-log.txt`, run in a fresh
  top-level session (the command wasn't visible in the session where it was
  authored — new `.claude/commands/*` only becomes available in a session
  started after the file exists).
- Did `$ARGUMENTS` get substituted: yes — the report opens
  "Report: materials/error-log.txt" and analyzes that exact file with no
  clarifying question needed.
- Trigger vs. root cause: explicitly separated as two headed sections.
  Trigger — `ENOSPC` in `state.ts:21` during `saveState`, transient, resolved
  by ops at 00:13:48. Root cause — `runSync` (`run.ts:36`) checkpoints
  `lastSyncedAt` only once, after the *entire* batch loop finishes; once
  Slack `429`s stretch a run past the scheduler's 4m30s budget, the process
  is `SIGKILL`'d before that checkpoint runs, so the backlog is resent
  identically every 5 minutes — independent of the disk being fixed.
- Proposed test: a new case in `app/src/sync/run.test.ts`'s
  `describe("runSync", ...)` — an integration that succeeds for `ld_0001`
  then rejects for `ld_0002` (simulating a mid-batch kill before the final
  `saveState`), asserting `lastSyncedAt` is unchanged, then a second
  `runSync` call asserting `ld_0001` is resent — reproducing the duplicate
  bug directly.
- Did it stop where the Stop rule says: yes — ended with "No source files
  were modified. Waiting for confirmation before writing or running this
  test," matching the command's Stop rule exactly.
- Follow-up (optional per the walkthrough, done here): added the proposed
  test to `app/src/sync/run.test.ts` and fixed `app/src/sync/run.ts` by
  moving the `saveState` checkpoint from once-per-batch to once-per-lead, so
  an interrupted run keeps credit for leads already sent. Scope stayed in
  `sync/` only (not protected). Result: 19/19 tests green (18 baseline + 1
  new), `check:rules` unaffected by this change (still 8 at the time, all in
  `sheets-append.ts`/`state.ts`), `typecheck` clean.
- **Revised after code review** — this is the iteration the walkthrough
  expects ("корінну причину агент може знайти не з першого разу"), not a
  silent correction: code review flagged a more precise root cause than the
  once-per-batch checkpoint above. `loadState` (`state.ts:13-17`, old
  version) caught any JSON-parse failure and **silently** fell back to
  `INITIAL_STATE` (epoch). `saveState` wrote with a plain `writeFileSync`
  (non-atomic), and `runSync` unconditionally re-saved whatever `loadState`
  returned as its very first action. Put together: the `ENOSPC` write at
  00:05/00:10 (`materials/error-log.txt`) could leave the state file
  truncated/corrupted; the very next run's `loadState` would swallow that
  silently and hand back epoch; and the unconditional resave would then
  immediately bake that wrong epoch value back into the file before
  processing anything — erasing the evidence and converting a small backlog
  into a full-history resend, which is a better fit for the "392 similar
  lines skipped" burst than a same-run scheduler timeout would be. `ENOSPC`
  is the trigger either way; the root cause is this silent, unsurfaced
  fallback plus the two amplifiers (non-atomic write, unconditional resave)
  — a direct violation of the architecture brief's own convention #4 ("не
  можна тихо підставити значення за замовчуванням"), and also the reason
  `check:rules` already flagged `state.ts` for `json-via-parse`: it never
  went through `parseJson`+guard.
  Fix: `state.ts` now uses `parseJson`+guard (`loadState` returns
  `Result<SyncState>`); a corrupted file is a hard error the caller must see,
  not a default. `saveState` writes to a temp file and `renameSync`s over the
  target (atomic). `run.ts` aborts loudly (`log.error`, zeroed report) if
  `loadState` fails, and dropped the unconditional top-of-function resave.
  Added `app/src/sync/run.test.ts`: a corrupted-state-file case asserting
  `runSync` sends nothing, returns a zeroed report, leaves the corrupted file
  untouched (no silent overwrite), and logs the abort. Also sorted `pending`
  by `createdAt` ascending before the checkpoint loop, since `runSync` only
  had a `readonly Lead[]` with no ordering guarantee — an out-of-order batch
  could otherwise let a later lead's checkpoint skip an earlier, still-failed
  one. Result: 24/24 tests green, `check:rules` now **0** total (fixing
  `state.ts`'s `json-via-parse` as a side effect), `typecheck` clean.
  Known, deliberately unaddressed limitation: if one integration succeeds for
  a lead and a later one fails, a retry still re-calls the already-succeeded
  integration (no per-lead/per-integration delivery ledger or idempotency
  key). Fixing that needs a state-schema change beyond this bug's scope and
  isn't part of the incident being reproduced here; flagged, not silently
  dropped.

### `/refactor`

- Invocation: `/refactor app/src/integrations/sheets-append.ts`, run in this
  session once the command became available after being authored.
- `npm run check:rules` for this file: before **7** (`no-any` x2,
  `http-via-core` x1, `env-via-config` x1, `json-via-parse` x1,
  `log-via-logger` x2) → after **0**. Repo total: before 8 → after 1 (the
  remaining violation is `sync/state.ts`, outside this file's scope).
- `npm test` before / after: 19/19 green both times.
- What changed in behavior: nothing the tests pin down — same webhook URL
  construction, same request body shape, same success/error return values;
  the two existing tests in `sheets-append.test.ts` passed unmodified. The
  file now goes through `readEnv`/`postJson`/`parseJson`+guard/`log` instead
  of raw `process.env`/`fetch`/`JSON.parse`/`console.log`, and dropped `any`.
- Scope: only `app/src/integrations/sheets-append.ts` changed; no test
  assertions edited, nothing under `app/src/core/**` touched.

### `/generate-integration`

- Invocation: `/generate-integration telegram-notify`, run in a fresh
  top-level session.
- Did `$ARGUMENTS` get substituted: yes — it read `types.ts`, `slack-notify.ts`
  (+ its test), `architecture.md`, `conventions.md`, `index.ts`, `http.ts`,
  `config.ts`, `parse.ts`, `sheets-append.ts` (+ its test) as pattern
  references, then built the `telegram-notify` integration named in the
  argument with no clarifying question.
- Files created: `app/src/integrations/telegram-notify.ts` (Telegram Bot API
  `sendMessage`, via `readEnv`/`postJson`/`parseJson`+guard/`log`, payload has
  name/source/budget only — no email/phone), `telegram-notify.test.ts`
  (message formatting excludes PII, missing `TELEGRAM_BOT_TOKEN`, successful
  send asserting URL+body, Telegram-side `ok:false` error). One line added to
  `integrations/index.ts` registering `telegramNotify`.
- Verified independently (not just trusting the agent's own report): re-ran
  `npm test` (23/23 passed, 7 test files), `npm run typecheck` (clean),
  `npm run check:rules` (still 1 total violation, the pre-existing
  `sync/state.ts` one — no new violations, `no-new-deps` and
  `core-untouched` both 0).
- Scope: exactly the 3 expected files (module, test, one registry line);
  `app/src/core/**` untouched.

## Task E (bonus) — hook

- Files: `.claude/settings.json` (`PreToolUse` hook, matcher `Edit|Write`,
  running `node .claude/hooks/protect-core.mjs`), `.claude/hooks/protect-core.mjs`
  (Node, reads the tool-call JSON from stdin, checks `tool_input.file_path`
  against `app/src/core/`, writes to stderr and exits 2 to block).
- Attempt: asked to add a comment at the start of `app/src/core/log.ts` (a
  real `Edit` tool call in this session, not a simulation). Response (quote):
  `PreToolUse:Edit hook error: [node .claude/hooks/protect-core.mjs]: Blocked:
  "app/src/core/log.ts" is under app/src/core/**, the protected platform core
  (see .claude/rules/do-not-touch.md). Core changes go through a separate PR
  reviewed by the platform team. Describe what needs to change in core and
  why, instead of editing it here.`
- Verified `git status --short app/src/core/log.ts` showed no change and the
  file content was untouched after the blocked attempt.
- Also unit-tested the script directly (piping synthetic `PreToolUse` JSON on
  stdin) with both `/`- and `\`-separated Windows paths: blocks
  `app/src/core/log.ts` in both cases (exit 2), allows an unrelated file like
  `app/src/integrations/slack-notify.ts` (exit 0).
- **Revised after code review**: the matcher only covered `Edit|Write`, so a
  session using `Bash` to write into `app/src/core/**` (e.g. `sed -i`, a
  redirect, `mv`) would bypass the hook entirely, since `protect-core.mjs`
  only read `tool_input.file_path`, which `Bash` doesn't have. Added `Bash`
  to the matcher and a separate check path in the script: for `Bash` calls it
  pattern-matches `tool_input.command` for a mention of `app/src/core`
  combined with a write-shaped operator/command (`>`/`>>`, `mv`/`cp`/`rm`/
  `sed -i`/`tee`/etc., `git checkout|apply|mv|restore|clean`,
  `writeFileSync`/`appendFileSync`). This is a heuristic, not a shell parser
  — documented in the script's own comment as raising the bar, not a
  guarantee against every indirect way Bash could reach the path (e.g. a path
  built from a variable). Verified directly: `echo 'x' >> app/src/core/log.ts`
  via a synthetic `Bash` `PreToolUse` payload → blocked (exit 2); `cat
  app/src/core/log.ts` (read-only) → allowed (exit 0); the existing `Edit`/
  `Write` checks on `app/src/core/log.ts` and a non-core file still behave
  exactly as before.
