# System Facts Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine normalizes supplied operating-system and hardware observations for
interactive developer workstations and headless servers. It is deliberately
side-effect free. It does not read files, execute commands, alter settings, or
open a mesh connection.

Supported triggers are `install.preflight`, `system.facts.request`,
`workload.changed`, and `health.interval`. Unsupported triggers fail closed.
The result contains facts, pressure classifications, capabilities,
limitations, and no actions. Native platform adapters remain the authority for
execution in a later integration phase.
