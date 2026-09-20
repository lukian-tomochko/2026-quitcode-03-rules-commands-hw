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

- Invocation: `/analyze-error materials/error-log.txt`
- Did `$ARGUMENTS` get substituted: <TODO>
- What the agent named as the root cause (file, line, mechanism): <TODO>
- How it distinguished trigger from cause: <TODO>
- Did it stop where the Stop rule says: <TODO>

### `/refactor`

- Invocation: `/refactor <file>`
- `npm run check:rules` for this file: before <N> → after <N>
- `npm test` before / after: <TODO>
- What changed in behavior (should be: nothing the tests pin down): <TODO>

### `/generate-integration`

- Invocation: `/generate-integration <service>`
- Files created: <TODO>
- `npm test`, `npm run check:rules`: <TODO>

## Task E (bonus) — hook

- Files: <e.g. `.claude/settings.json`, `.claude/hooks/protect-core.mjs`>
- Attempt to edit `app/src/core/...` → hook's response (quote): <TODO>
