# Display Pipeline Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies display presence, refresh, resolution, HDR, and VRR
evidence. It keeps incomplete display facts explicit and distinguishes
headless hosts from interactive hosts without inferring a display policy.

It is analysis-only. It does not change resolution, refresh, HDR, VRR, files,
or transport.

The dedicated `library.js` classifies display presence and pipeline evidence,
compares snapshots, and emits immutable local review envelopes without display
mutations.

The four dedicated turbo/library pairs extend that boundary with:

- `resolution-drift`: actual resolution transitions and evidence gaps.
- `refresh-drift`: documented refresh-rate movement.
- `hdr-capability`: observed HDR capability and state movement.
- `vrr-stability`: observed variable-refresh state and movement.

All four pairs are lazy-loaded, trigger-bound, analysis-only, and remain under
the 500-LOC file cap. They do not change resolution, refresh, HDR, VRR, files,
or transport.
