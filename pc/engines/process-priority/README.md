# Process Priority Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies documented process priority labels and reports
foreground, protected, unknown, and elevated-priority counts. Unsupported or
missing labels remain unknown rather than being treated as permission to
change a process.

It is analysis-only. It does not renice, terminate, suspend, modify files, or
open transport.

The dedicated `library.js` classifies priority labels and ownership flags,
compares process snapshots, and emits immutable local review envelopes without
changing process priority.

The four lazy-loaded turbo/library pairs are:

- `priority-drift`: bounded priority signature movement and persistence plans.
- `unknown-label`: undocumented-label rates and persistence plans.
- `foreground-protection`: elevated, protected, and unprotected foreground
  evidence.
- `priority-volatility`: combined priority, foreground, and protection-state
  movement.

Each pair has a dedicated library, immutable report/envelope boundary, strict
trigger validation, headless-safe observation behavior, and its own changelog
and tests. No pair mutates process priority, suspends or terminates a process,
edits user files, or opens HTTP, API, REST, socket, or other transport.
