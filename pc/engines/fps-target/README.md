# FPS Target Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine proposes a bounded FPS target from a user-owned target,
documented display refresh, or observed FPS. It reports target provenance and
the observed gap so a later authorized control layer can make an explicit
decision.

It is analysis-only. It never applies a cap, changes display settings,
modifies files, or opens transport.
