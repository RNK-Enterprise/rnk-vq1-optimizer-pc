# Display Pipeline: HDR Capability Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo observes HDR capability and state movement. It is
lazy-loaded by the display-pipeline engine and fires only on the four declared
triggers. It never enables or disables HDR, changes display policy, modifies
files, or opens transport.
