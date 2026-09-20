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
- **Second review round, two more real bugs in the fix above, both fixed:**
  1. `Lead.createdAt` isn't guaranteed unique — `makeLead` accepts any id/timestamp
     pair, so two leads can legitimately share one `createdAt`. The per-lead
     checkpoint from the previous round would let the *first* lead's timestamp
     become the watermark, then exclude the *second* one forever via the
     strict `createdAt > lastSyncedAt` filter if a crash landed between them.
  2. The checkpoint advanced past a lead even when one of its integrations
     returned `Result` `ok: false` (a normal delivery failure, not a crash) —
     so a failed lead could be silently, permanently skipped instead of
     retried, which also contradicts the `Result`-over-exceptions convention.

  Fix: `runSync` now processes `pending` in **groups of equal `createdAt`**
  (already sorted ascending) instead of one lead at a time, and only advances
  `lastSyncedAt`/calls `saveState` once **every** lead in a group has had
  **every** integration succeed. A failure anywhere in a group — thrown
  exception or `Result` `ok: false` — stops the run there without advancing
  the watermark, so the whole group (including any leads in it that already
  succeeded) is retried on the next run rather than being skipped. Also made
  `saveState` return `Result<void>` (`state.ts`) instead of throwing on a
  write failure, and `runSync` now checks it and aborts via `log.error`
  instead of an unhandled rejection. Added a `YYYY-MM-DDTHH:mm:ss.sssZ`
  format check to `state.ts`'s `isSyncState` guard, since a non-ISO string
  like `"z"` previously passed the string-only guard and — because it sorts
  after every real timestamp lexicographically — would have silently
  excluded every lead with no error at all.
  New tests in `run.test.ts`: two leads sharing `createdAt` with a crash
  between them (neither is dropped, and the group is fully retried); a
  `Result: ok:false` failure that must not advance the checkpoint past it and
  must not be skipped on retry; a non-canonical `lastSyncedAt` value rejected
  the same way a corrupted file is; a `saveState` write failure (missing
  parent directory) handled as a controlled abort. Result: 29/29 tests green,
  `check:rules` still **0**, `typecheck` clean.
  Known, deliberately unaddressed limitation (narrower than before this
  round): if one integration succeeds for a lead and a *different* integration
  fails for that same lead, a retry of that lead's group still re-calls the
  already-succeeded integration (no per-lead/per-integration delivery ledger
  or idempotency key) — the lead itself is no longer skipped or lost, but it
  can be redelivered to that one integration. Fixing that needs a
  state-schema change beyond this bug's scope; flagged, not silently dropped.
- **Third review round — group processing didn't stop on the first failure**:
  the grouping fix above set `groupOk = false` on a `Result` `ok: false` but
  kept going — calling further integrations for that same lead, and moving on
  to later leads in the same group. Since the group as a whole still wasn't
  checkpointed, any later lead that happened to fully succeed in that same
  run had its success silently discarded and redelivered on retry — a real
  duplicate-delivery bug, not just wasted work. Fixed by breaking out of the
  entire group immediately on the first `ok: false`, via a labeled loop.
  Added a test: two leads sharing `createdAt`, the first fails — asserts the
  second is never attempted in that run, and the whole group (both leads) is
  retried from the start next time. Result: 30/30 tests green, `check:rules`
  still **0**, `typecheck` clean.

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
- **Revised after code review**: `telegram-notify.ts` puts the bot token in
  the request URL (Telegram's Bot API has no header-based auth), and
  `core/http.ts` logs that URL verbatim on a failed attempt — `core/http.ts`
  and `core/log.ts` are protected, so this can't be patched from here.
  Checked whether it's actually exposed: `core/log.ts`'s existing `redact()`
  already has a pattern for `bot\d{6,}:[A-Za-z0-9_-]{20,}`, which matches a
  real Telegram token's shape. Also disabled `postJson` retries for Telegram
  (`retries: 0`): a retry after Telegram already accepted the message but the
  client saw a transport error would resend it, and there's no dedup key.
- **Third review round**: the redact test above originally spied on
  `console.log`/`console.error` directly to observe the effect, which itself
  repeats the "no direct `console` in `app/src/**`" convention the test file
  had already been cleaned of once. Replaced it with a direct call to
  `redact()` (imported from `core/log.ts`, a public export) on the exact URL
  shape `telegram-notify.ts` builds — same guarantee, no `console`/`fetch`
  mocking needed at all.

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
- **Second review round — symlink bypass (CWE-59), fixed**: `Edit`/`Write`
  checked the target path with plain `path.resolve()`, which doesn't resolve
  symlinks — a symlink named e.g. `app/src/core-link` pointing at
  `app/src/core` would let a write to `core-link/new.ts` pass the
  `app/src/core/` prefix check under a different name. Fixed by
  canonicalizing through `fs.realpathSync` on the target's closest *existing*
  ancestor (the file itself may not exist yet, e.g. for `Write`) before
  re-appending the remaining path and checking the prefix. Also added `ln`
  and `symlinkSync`/`fs.symlink` to the `Bash` heuristic's write-shaped
  patterns, to catch the symlink-creation step itself
  (`ln -s app/src/core core-link`). Verified with a synthetic fixture (a real
  junction/symlink created under a scratch directory, not in this repo):
  writing to `<link>/new.ts` (nonexistent file, symlinked parent) resolved to
  the real protected path and was blocked; `ln -s app/src/core ...` via
  `Bash` was blocked; all prior cases (direct core edit, non-core edit, Bash
  write/read, the commit-message false positive) re-verified unaffected.
  (The write-through-a-variable-named-symlink gap noted here initially was
  closed in the third review round below — see that entry for the current,
  narrower limitation.)
- **Same round — own hook false-positived on a commit message**: the
  mandatory `Co-Authored-By: ... <noreply@anthropic.com>` trailer's closing
  `>` matched the original `>>?[^&]` redirection pattern (any `>` not
  followed by `&`), blocking a real `git commit`. Tightened the pattern to
  require whitespace/start-of-string before the `>` and a path-like token
  after it, so it only matches redirection-shaped text, not an email's
  closing bracket. Re-verified against both the commit message (no longer
  matches) and a real `echo x >> app/src/core/log.ts` (still matches).
- **Third review round — Bash bypass via a shell variable pointing at a
  pre-existing symlink**: the documented limitation above
  (`p=core-link; printf x > "$p/log.ts"`) was flagged as a real functional
  gap worth closing, not just a limitation to accept — the command text
  never mentions `app/src/core` at all when the symlink has an unrelated
  name. Rather than parse shell syntax, the check now extracts bare
  path-like tokens from a write-shaped command (including the right-hand
  side of simple `VAR=value` assignments) and, for each one that exists on
  disk, resolves it through the same `realpath`-based canonicalizer used for
  `Edit`/`Write` to see if it lands under `app/src/core` — filesystem truth
  instead of text matching, so it doesn't matter what name the symlink was
  given. This caught two bugs in the first attempt at this fix: the
  redirection pattern required a word-like character immediately after `>`,
  which silently excluded quoted/variable targets like `> "$p/..."` (the
  exact shape of the PoC); and the tokenizer only split on whitespace, so
  `p=core-link;` kept its trailing semicolon and failed the path-shape check.
  Both found by testing directly against the reviewer's exact PoC rather
  than assuming the fix worked. Verified: the exact PoC, run against a real
  symlink created in a scratch fixture (not this repo) → blocked, naming the
  resolved token; the same shape pointed at an unrelated, non-core directory
  → allowed; the full prior regression set (direct core edit/write, symlinked
  Edit/Write, `ln -s`, Bash read, the commit-message trailer) re-verified
  unaffected. Documented limitation, further narrowed but not eliminated:
  command substitution (`$(...)`), paths built from string concatenation, and
  anything not yet existing on disk at check time still can't be resolved
  this way — closing that fully would mean a real shell sandbox or blocking
  Bash writes outright, disproportionate to what this hook is for.
- **Fourth review round — two more real bypasses, both fixed, plus a stale
  doc correction:**
  1. The `Bash` redirection pattern required whitespace (or start-of-string)
     immediately before `>`, to avoid matching the closing `>` of an email
     like `<noreply@anthropic.com>`. But bash accepts redirection with **no**
     space at all (`printf x>app/src/core/blocked.ts`) — and since the whole
     `Bash` branch, including the plain `PROTECTED_MENTION` text check, was
     gated behind that redirection pattern matching, a no-space redirect
     skipped the check entirely even though the command *literally* contains
     `app/src/core`. Fixed by excluding only the actual email shape via a
     negative lookbehind (`(?<!<[\w.+-]+@[\w.-]+)>`) instead of requiring
     whitespace, so `>` is recognized as redirection-shaped regardless of
     what's on either side, while `<...@...>` still isn't.
  2. The candidate-token check from the third round only resolved a token if
     `existsSync` was already true, skipping the not-yet-existing target
     that's the normal case for a file a write is about to create — e.g.
     `printf x > app/src/./core/blocked.ts` doesn't match
     `PROTECTED_MENTION`'s exact text (the `./` breaks it) and `blocked.ts`
     doesn't exist yet, so it passed. Fixed by dropping the `existsSync`
     guard entirely: `canonicalize()` already walks up to the closest
     *existing* ancestor for exactly this case (that's what it was built for
     in the second round, for `Edit`/`Write`) — the candidate check just
     wasn't using that capability for every token.
  Both were confirmed as real, working bypasses first (isolated fixture,
  before any fix), not assumed from the report. Verified after fixing:
  `printf x>app/src/core/blocked.ts` (no space) → blocked; `printf x >
  app/src/./core/blocked.ts` (nonexistent target, `./` segment) → blocked,
  naming the resolved candidate; `npm test 2>&1` (fd duplication, unrelated
  file) → still allowed; the full prior regression set (direct core
  edit/write, symlinked Edit/Write, `ln -s`, the variable-symlink PoC, a
  benign variable-based write, Bash read, the commit-message trailer) →
  re-verified unaffected. This also means the "anything not yet existing on
  disk" limitation noted in the third-round entry above no longer applies —
  left there as history of what was true at the time, not corrected in
  place. Also removed a stale sentence from the second-round entry above
  that still claimed shell-variable paths were undetected, which the third
  round had already fixed — CodeRabbit caught the contradiction between two
  of this file's own paragraphs.
- **Fifth review round — variable value concatenated with more literal path
  text, and a change of approach**: `d=app/src; printf x >
  "$d/core/blocked.ts"` defeated the third round's candidate-resolution
  fix — `extractCandidatePaths` correctly captured `app/src` as the
  assignment's value (safe on its own, not under `app/src/core`), but the
  actual redirection target is `$d` concatenated with the literal
  `/core/blocked.ts`, which the extractor can't reconstruct: the token
  `"$d/core/blocked.ts"` contains `$`, so it's skipped entirely as
  unresolvable, and nothing else in the command catches it. This is the same
  root problem as every previous Bash-heuristic gap, just in a new shape:
  there is no fixed set of regexes that bounds every way a shell can build a
  string, so stopping at "yet another pattern" would only produce a sixth
  round with a different concatenation shape. Changed approach instead of
  patching again, per the explicit recommendation: **every write-shaped
  `Bash` command is now blocked outright**, regardless of what it mentions or
  resolves to — `PROTECTED_MENTION` and the candidate-token resolution logic
  were removed entirely. File changes go through `Edit`/`Write`, which report
  a structured, exact `file_path` this hook can always verify (and already
  does, including through symlinks, since the second round). The real cost
  of this, stated plainly: a Bash command that writes/renames/symlinks
  *anywhere*, not just under `app/src/core/**`, is now blocked too — e.g.
  `mv`, `cp`, `sed -i`, or a redirect against an unrelated file must go
  through `Edit`/`Write` instead. `Bash` remains fully usable for everything
  that isn't write-shaped: reads, `git` commands outside the blocked subset,
  `npm`/`node` invocations, `cd`, etc.
  Verified: the exact new PoC → blocked; the third round's variable-symlink
  PoC and the fourth round's no-space/`./`-normalization cases → all still
  blocked (now unconditionally, without needing to resolve anything); the
  previously-"benign" variable-based write case → now also blocked, which is
  the intended, stricter behavior, not a regression; `npm test 2>&1` (fd
  duplication) and a plain `cd app && npm test` → still allowed; direct
  core `Edit`, non-core `Edit`, the symlinked `Edit`/`Write` case, `Bash`
  reads, and the commit-message trailer → all re-verified unaffected. Each
  case run as an isolated command after the sweep's own descriptive `echo`
  text (containing the bare word "ln") tripped the new unconditional check
  on the test harness itself — a small proof, in passing, of how literally
  the policy now applies.
