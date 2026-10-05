# Capability Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo evaluates which observations and controls are available for a
normalized host profile. It distinguishes supported, observation-only,
admin-required, unavailable, unknown, and not-applicable capabilities. It
also reports whether a profile is ready, partial, or blocked and makes the
execution boundary explicit for headless, interactive, and unknown hosts.

The turbo is analysis-only. It does not apply controls, access user files,
open network connections, or connect to the optimizer mesh.
