# Power-Profile Control-Boundary Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo compares explicit power-profile control capability evidence. A
missing or non-boolean capability is unknown; it is never treated as consent.

It is review-only. It does not switch profiles, change governors, modify
files, or open transport. It fires only for an explicit supported trigger and
loads its analysis when invoked.
