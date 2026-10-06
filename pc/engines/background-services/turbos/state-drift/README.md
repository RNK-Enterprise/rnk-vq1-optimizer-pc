# Background-Services State-Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo compares explicit service identities and states over bounded
samples. Critical failed services remain a protection state.

It is analysis-only. It does not start, stop, disable, terminate, modify
service files, or open transport. It fires only for an explicit supported
trigger and loads its analysis when invoked.
