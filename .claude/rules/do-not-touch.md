# do-not-touch

<!-- No paths in frontmatter on purpose: this must apply in every session,
     not only when the agent reads app/src/**. -->

## Context

`app/src/core/**` is the agency's shared platform: the same core runs in
every client worker, and changes to it go through a separate PR reviewed by
the platform team. `app/scripts/**`, `materials/**`, `.coderabbit.yaml`, and
`.github/**` are this assignment's own infrastructure, not project code.

## Rule

- Do not edit, add, or delete files under: `app/src/core/**`,
  `app/scripts/**`, `materials/**`, `.coderabbit.yaml`, `.github/**`. This
  applies always, with no exceptions — a "small fix" or "just one type" still
  counts as editing.
- If a task looks impossible without touching one of these paths, **stop**
  and describe in chat: exactly which file, exactly what change, and why.
  Do not make the change yourself and do not look for a way around the
  restriction.
- There is no "unless the task really needs it" clause — every task will
  claim it does; the only response when this rule is in the way is to stop
  and describe.

## How to verify

- `git status --short` — no path from the list above appears after the
  agent's work.
- `cd app && npm run check:rules` — the `core-untouched` line is 0 (checked
  against `app/scripts/core.lock.json`).
