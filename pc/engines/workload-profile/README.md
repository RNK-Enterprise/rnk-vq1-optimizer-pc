# Workload Profile Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies declared gaming, creative, development, server, idle,
and unknown workload context. It preserves interactive and headless context
without assuming permission to change applications or services.

It is analysis-only. It does not change processes, application settings,
files, or transport.

The dedicated library is `pc/engines/workload-profile/library.js`. It
classifies normalized workload observations for the engine and remains
analysis-only.

The four independent turbo/library pairs are:

- `context-drift`: declared workload context movement.
- `intensity-trend`: bounded workload-intensity movement.
- `environment-boundary`: interactive/headless boundary evidence.
- `declaration-stability`: explicit declaration and interactive-flag movement.

Each pair is lazy and trigger-driven. It returns bounded evidence and review
plans only; it does not change processes, applications, services, or files.
