---
description: Bring one file up to project conventions without changing its observable behavior
argument-hint: <file path>
---

# refactor

**Target:** $ARGUMENTS
(If the line above has no concrete path, the target is the text right after
the command name in the message. If there's none there either, ask and stop.)

## Steps

1. Read the target file and its existing test file. Read
   `.claude/rules/conventions.md` and `.claude/rules/architecture.md` for
   what "compliant" means here — do not restate them, just apply them.
2. Record the baseline: `cd app && npm run check:rules && npm test` (note
   the count for this file and pass/fail).
3. Rewrite the target file only, applying `.claude/rules/conventions.md`
   (don't restate it here), while keeping behavior identical: same URLs,
   same request bodies, same error strings the tests pin down.
4. Re-run `cd app && npm run check:rules && npm test` and compare to the
   baseline.

## Acceptance criteria

- [ ] `check:rules` violation count for this file: after <= before, ideally 0.
- [ ] `npm test` is green, and no test assertion was edited to make it pass.
- [ ] Only the target file changed — nothing else, and nothing under
      `app/src/core/**`.

## Stop

Scope is the named file only. Do not edit test assertions to make them pass,
and do not touch `app/src/core/**` or any other file. If compliance seems to
require either, stop and report what's blocking it instead of doing it.
