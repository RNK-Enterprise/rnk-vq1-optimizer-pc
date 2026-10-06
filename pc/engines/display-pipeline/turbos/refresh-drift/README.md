# Display Pipeline: Refresh Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo observes refresh-rate movement and bounded display
evidence. It is lazy-loaded by the display-pipeline engine and fires only on
the four declared triggers. It never changes refresh, resolution, HDR, VRR,
files, or transport.
