# Power Profile Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies documented active power profiles, available profile
labels, and the declared control boundary. Custom or unknown profiles remain
user-owned review evidence.

It is analysis-only. It does not switch profiles, change governors, alter
administrator settings, modify files, or open transport.

The dedicated library is `pc/engines/power-profile/library.js`. It classifies
normalized profile observations for the engine and remains analysis-only.
