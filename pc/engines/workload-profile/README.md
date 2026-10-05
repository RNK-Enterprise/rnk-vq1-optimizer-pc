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
