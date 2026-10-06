# Startup Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine reports enabled, disabled, required, user-owned, unknown, and
delay evidence for startup entries. It preserves ownership of boot and login
configuration.

It is analysis-only. It does not disable startup items, edit boot entries,
modify files, or open transport.

The dedicated library is `pc/engines/startup/library.js`. It classifies
normalized startup observations for the engine and remains analysis-only.

The four independent turbo/library pairs are:

- `entry-drift`: entry-count and enabled-state movement.
- `delay-trend`: startup-delay movement and review bands.
- `ownership-boundary`: user-owned, system-owned, and unknown boundaries.
- `requiredness-drift`: required-entry disablement and requiredness movement.

Each pair is lazy and trigger-driven. It returns bounded evidence and review
plans only; it does not disable startup items, edit boot entries, or change
files.
