---
paths:
  - "app/src/**/*.ts"
---

# architecture

## Context

`lead-sync` is built as layers with a fixed dependency direction
(`materials/architecture-brief.md`): `core/` is the platform, shared with
other agency workers; `integrations/` and `sync/` are this project's own
code. Breaking the dependency direction, or inventing new core exports,
breaks this for everyone else using the same core.

## Rule

- Dependency direction: `integrations/` and `sync/` import from `core/`.
  `core/` never imports from the rest of the project.
- `integrations/` know nothing about `sync/`. `sync/` talks to integrations
  only through the `Integration` contract (`core/types.ts`) and the registry
  `integrations/index.ts` — never by importing an integration file directly.
- A new external system is exactly three files: `src/integrations/<kebab-name>.ts`,
  `src/integrations/<kebab-name>.test.ts`, and one line in
  `src/integrations/index.ts`. Nothing else changes.
- Core's public API is a closed list — nothing else exists, and none of it
  is to be invented:
  - `core/types.ts` → `Lead`, `Result<T>`, `Integration`
  - `core/http.ts` → `postJson(url, body, options?)`, `PostOptions`
  - `core/config.ts` → `readEnv(name)`
  - `core/parse.ts` → `parseJson(text, guard, label?)`, `Guard<T>`,
    `isRecord`, `isString`, `isNumber`
  - `core/log.ts` → `log.info`/`log.warn`/`log.error`, `redact(text)`
  - If something else from core is needed, that is a core change — see
    `do-not-touch`.

## How to verify

- `cd app && npm run check:rules` — a new integration file shows up both on
  disk and in `integrations/index.ts`; the core-boundary rule counts
  (`http-via-core`, `env-via-config`, `json-via-parse`, `log-via-logger`)
  did not increase for the changed files.
- `grep` the diff: imports from `core/` only use the names listed above, and
  there is no `sync` import of a specific integration file directly.
