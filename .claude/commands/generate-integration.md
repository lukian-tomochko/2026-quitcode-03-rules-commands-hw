---
description: Scaffold a new integration (module + test + registry line) following the existing architecture
argument-hint: <service name>
---

# generate-integration

**Target:** $ARGUMENTS
(If the line above has no concrete service name, the target is the text
right after the command name in the message. If there's none there either,
ask and stop.)

## Steps

1. Read `app/src/core/types.ts`'s `Integration` contract and one existing
   integration (`app/src/integrations/slack-notify.ts`) as the pattern to
   follow. Read `.claude/rules/architecture.md` and
   `.claude/rules/conventions.md` for the constraints — do not restate them.
2. Create `app/src/integrations/<kebab-name>.ts`: implement `Integration`
   using `postJson`/`readEnv`/`log` (and `parseJson`+guard if the response
   body is parsed); `send()` returns `Result<void>` and never throws; the
   outbound payload carries only name, source, and budget — no email or phone.
3. Create `app/src/integrations/<kebab-name>.test.ts` next to it, covering:
   a successful send (assert URL and body), a missing required env var, and
   an error response from the external system. Mock the network with
   `vi.stubGlobal("fetch", ...)` and env with `vi.stubEnv`, matching the
   style of the existing integration tests.
4. Add exactly one line registering the new integration in
   `app/src/integrations/index.ts`.
5. Run `cd app && npm test && npm run check:rules`.

## Acceptance criteria

- [ ] Exactly three files touched: the new module, its test, and the one
      registry line in `index.ts`.
- [ ] `npm test` is green; `check:rules` shows no new violations.
- [ ] No new runtime dependency was added; `app/src/core/**` untouched.

## Stop

Do not touch `app/src/core/**` or add a dependency. When done, show a summary
of the files created and the `npm test` / `check:rules` results.
