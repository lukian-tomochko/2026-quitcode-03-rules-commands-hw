---
paths:
  - "app/src/**/*.ts"
---

# conventions

## Context

`materials/architecture-brief.md` fixes the project's code conventions:
errors as values, all I/O routed through core, zero dependencies.
`check:rules` (baseline: 8 violations in legacy code) statically checks
exactly this, so drift shows up immediately in the numbers.

## Rule

- Errors are values: functions that can fail return `Result<T>`; an
  integration's `send()` always returns `Result<void>` and never throws.
- Outbound HTTP only through `postJson()` from `core/http.ts` — no direct
  `fetch`, no new HTTP client (axios, got, ky).
- Environment variables only through `readEnv()` from `core/config.ts` — no
  reading `process.env` elsewhere, and no secrets written to logs or hardcoded.
- External JSON (API response, webhook body, state file) only through
  `parseJson(text, guard)` from `core/parse.ts` — no direct `JSON.parse()`,
  and no silent defaults on invalid data.
- Logging only through `log` from `core/log.ts` — no `console.*`; `log`
  redacts secrets.
- No `any` — use `unknown` plus a guard for unknown data.
- No new dependencies: the app has zero runtime dependencies.
- Notifications (Slack, messengers) never include a lead's email or phone —
  only name, source, and budget; full data goes only to record-keeping
  systems (the spreadsheet, CRM).
- File names are kebab-case; an integration's `name` field matches its file name.

## How to verify

- `cd app && npm test && npm run check:rules` — `no-any` and `no-new-deps`
  are 0 for changed files; `http-via-core`/`env-via-config`/`json-via-parse`/
  `log-via-logger` did not increase.
- `grep -n "console\.\|process\.env\|JSON\.parse\|fetch(" app/src/**/*.ts` —
  matches only inside the corresponding `core/*.ts` files.
- Manually check the notification payload in the diff/test — no email or
  phone present.
