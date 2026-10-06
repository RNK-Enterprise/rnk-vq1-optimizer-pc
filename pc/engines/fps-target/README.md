# FPS Target Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine proposes a bounded FPS target from a user-owned target,
documented display refresh, or observed FPS. It reports target provenance and
the observed gap so a later authorized control layer can make an explicit
decision.

It is analysis-only. It never applies a cap, changes display settings,
modifies files, or opens transport.

The dedicated `library.js` derives target candidates, compares provenance and
gaps, and emits immutable local review envelopes without applying a cap.

The four dedicated turbo/library pairs extend that boundary with:

- `target-source-drift`: movement between user, display, and observation provenance.
- `refresh-headroom`: available refresh budget and persistent collapse.
- `user-target-guard`: explicit user targets against documented refresh evidence.
- `observation-confidence`: weighted completeness of refresh, FPS, and target evidence.

All four pairs are lazy-loaded, trigger-bound, analysis-only, and remain under
the 500-LOC file cap. The family regression covers the base engine, base
library, and all four turbo/library pairs.
