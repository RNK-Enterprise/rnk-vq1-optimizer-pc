# Shader Cache Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies valid, stale, and unknown shader-cache evidence and
reports bounded cache size and ownership hints. Stale evidence becomes a
documented rebuild review, not permission to delete or regenerate files.

It is analysis-only. It does not delete caches, change drivers, rebuild files,
or open transport.
