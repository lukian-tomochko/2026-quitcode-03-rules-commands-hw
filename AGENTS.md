# AGENTS.md

## What this is

`lead-sync` is a lead-routing worker migrated from an n8n workflow for client
Studio Nova. Every 5 minutes it takes new leads from the site's form and fans
them out to integrations: a Slack channel for managers and a Google Sheet,
with CRM and messengers planned next. TypeScript, Node 22+, Vitest, zero
runtime dependencies.

## Commands

- Install: `cd app && npm install`
- Tests: `npm test`
- Typecheck: `npm run typecheck`
- Rule check: `npm run check:rules`

## Map

- `src/core/` — platform: types, HTTP, config, parsing, logger. **Protected**,
  see rule below.
- `src/integrations/` — one module per external system, plus the
  `index.ts` registry.
- `src/sync/` — sync run orchestration and state between runs.

## Rules (details in `.claude/rules/`)

1. Dependency direction and core's closed public API — see
   `.claude/rules/architecture.md`.
2. Errors as `Result<T>`; I/O only via `postJson`/`readEnv`/`parseJson`+guard/
   `log`; no `any`; no new dependencies — see `.claude/rules/conventions.md`.
3. `core/`, `scripts/`, `materials/`, `.coderabbit.yaml`, `.github/` are
   protected, no exceptions — see `.claude/rules/do-not-touch.md`.
4. Notifications never include a lead's email or phone — name, source, and
   budget only.
5. File names are kebab-case; an integration's `name` field matches its
   file name.
6. A new integration is exactly three files: the module, its test, and one
   line in the registry.
7. Tests mock the network and environment (`vi.stubGlobal`, `vi.stubEnv`) —
   no real network calls.

## Before committing

`cd app && npm test && npm run typecheck && npm run check:rules` — all green,
no new `check:rules` violations, no changes under the protected paths above.
