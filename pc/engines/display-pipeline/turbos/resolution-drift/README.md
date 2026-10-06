# Display Pipeline: Resolution Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo observes resolution transitions and bounded display
evidence. It is lazy-loaded by the display-pipeline engine and fires only on
the four declared triggers. It never changes resolution, refresh, HDR, VRR,
files, or transport.
