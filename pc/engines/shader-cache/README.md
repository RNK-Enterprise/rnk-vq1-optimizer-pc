# Shader Cache Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies valid, stale, and unknown shader-cache evidence and
reports bounded cache size and ownership hints. Stale evidence becomes a
documented rebuild review, not permission to delete or regenerate files.

It is analysis-only. It does not delete caches, change drivers, rebuild files,
or open transport.

The dedicated library is `pc/engines/shader-cache/library.js`. It classifies
normalized shader-cache observations for the engine and remains analysis-only.

The engine now has four lazy, trigger-driven turbo/library pairs:

- `validity-drift`: bounded valid, stale, and unknown validity movement.
- `ownership-boundary`: explicit system-owned, user-owned, and unknown ownership.
- `size-trend`: bounded cache-size growth and shrinkage review.
- `rebuild-evidence`: documented rebuild-evidence review without execution.

Each pair is analysis-only. Its library validates turbo reports, merges
bounded evidence, builds environment-aware review plans, and creates triggered
envelopes. No pair deletes, rebuilds, moves, or modifies cache files, changes
drivers, or opens transport.
