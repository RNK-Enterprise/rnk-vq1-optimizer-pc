# Memory Policy Pressure-Policy-Drift Library

Status: implementation complete locally; pending Odinn sign-off.

This dedicated library validates pressure-policy drift reports, merges bounded
counts, and builds environment-aware observation plans and immutable local
envelopes. It does not import the turbo, change policy, access files, or open
transport.

The library is analysis-only. Policy application and consent remain outside
this boundary; its future mesh endpoint is a separate integration step.
