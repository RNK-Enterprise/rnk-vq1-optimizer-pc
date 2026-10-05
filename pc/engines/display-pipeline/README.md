# Display Pipeline Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies display presence, refresh, resolution, HDR, and VRR
evidence. It keeps incomplete display facts explicit and distinguishes
headless hosts from interactive hosts without inferring a display policy.

It is analysis-only. It does not change resolution, refresh, HDR, VRR, files,
or transport.
