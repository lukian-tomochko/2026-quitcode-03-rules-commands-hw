---
description: Log or stack trace -> root cause report (trigger vs. cause), with a proposed reproducing test
argument-hint: <path to a log file or stack trace>
---

# analyze-error

**Target:** $ARGUMENTS
(If the line above has no concrete path, the target is the text right after
the command name in the message. If there's none there either, ask and stop.)

## Steps

1. Read the target log/stack trace in full (default: `materials/error-log.txt`
   if no target was given). Note every timestamped error and every `SYSTEM`/
   `ops` line around it — not just the first failure.
2. Identify the **trigger**: the first hard failure and its immediate,
   proximate cause (the thing someone would blame in the first minute).
3. Identify the **root cause**: why the symptom kept recurring or lasted
   after the trigger condition was already resolved. This requires looking
   at what happens on later, undisturbed runs, not just the first crash —
   check the mechanism in the relevant source (e.g. `app/src/sync/run.ts`,
   `app/src/sync/state.ts`) for how state/progress is persisted between runs.
   Trigger and root cause must be two different things — if they turn out
   identical, look again before reporting.
4. For the root cause, cite the specific file, line, and mechanism (not a
   vague description). Reference project rules by link
   (`.claude/rules/architecture.md`, `.claude/rules/conventions.md`) rather
   than restating them.
5. Propose one test that would have caught this: which file it would live
   in, what it sets up, and what it asserts. Do not write or run it yet.

## Acceptance criteria

- [ ] Trigger and root cause are reported as two distinct, separately labeled
      findings.
- [ ] Root cause cites a specific file/line/mechanism, not a generic
      description.
- [ ] A concrete reproducing test is proposed (file + setup + assertion).
- [ ] No source file was modified.

## Stop

Do not touch any code. Output the report and the proposed test plan, then
stop and wait for explicit confirmation before writing or running anything.
