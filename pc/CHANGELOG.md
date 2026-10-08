# PC browser and mesh changelog

## 2026-10-08

- Removed all non-PC host adapters, UI files, gateway relay code, and related
  tests from the public PC release.
- Kept the PC browser host, native authority, and local typed mesh as the
  supported surfaces.
- Added strict coverage collection for the entire PC runtime tree.

## 2026-10-07

- Scoped the completeness gate to the PC inventory: 34 engines, 136 turbos,
  and 170 paired libraries.
- Added lazy, trigger-validated engine execution to the local PC mesh.

## 2026-10-05

- Clarified the separation between the browser host and native whole-PC agent.
- Added persisted browser state, guarded capability detection, and an explicit
  local runtime-adapter boundary for approved actions.
