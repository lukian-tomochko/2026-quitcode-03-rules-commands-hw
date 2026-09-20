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
2. Record the baseline: `cd app && npm run check:rules` (note the count for
   this file) and `npm test` (note pass/fail).
3. Rewrite the target file only, so it satisfies conventions (`Result`
   instead of throwing, `postJson`/`readEnv`/`parseJson`+guard/`log` instead
   of raw `fetch`/`process.env`/`JSON.parse`/`console.*`, no `any`, no new
   dependencies) while keeping behavior identical: same URLs, same request
   bodies, same error strings the tests pin down.
4. Re-run `check:rules` and `npm test` and compare to the baseline.

## Acceptance criteria

- [ ] `check:rules` violation count for this file: after <= before, ideally 0.
- [ ] `npm test` is green, and no test assertion was edited to make it pass.
- [ ] Only the target file (and, if strictly required, its direct imports
      outside `core/`) changed — nothing under `app/src/core/**`.

## Stop

Scope is the named file only. Do not edit test assertions to make them pass,
and do not touch `app/src/core/**` or any other file. If compliance seems to
require either, stop and report what's blocking it instead of doing it.
