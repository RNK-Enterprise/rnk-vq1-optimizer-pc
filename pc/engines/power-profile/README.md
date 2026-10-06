# Power Profile Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies documented active power profiles, available profile
labels, and the declared control boundary. Custom or unknown profiles remain
user-owned review evidence.

It is analysis-only. It does not switch profiles, change governors, alter
administrator settings, modify files, or open transport.

The dedicated library is `pc/engines/power-profile/library.js`. It classifies
normalized profile observations for the engine and remains analysis-only.

The four dedicated turbo/library pairs are:

- `profile-drift`: compares explicit active-profile and advertised-profile
  evidence across bounded samples.
- `availability-drift`: tracks advertised profile additions and removals and
  checks active-profile membership.
- `control-boundary`: tracks explicit enabled, disabled, and unknown control
  capability without inferring permission.
- `environment-fit`: compares explicit interactive/headless context with the
  observed profile and reports review evidence.

Each pair is lazy and trigger-driven. Recommendations are observation or
review plans only; no pair switches profiles, changes governors, modifies
files, or opens network transport.
