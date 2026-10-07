# PC browser integration changelog

## 2026-10-07

- Scoped the completeness gate to the VQ1 PC inventory: 34 engines, 136
  turbos, and 170 paired libraries. The Foundry VQ2 surface is not inspected
  by this PC check.

## 2026-10-06

- Added lazy, trigger-validated engine execution to the local PC mesh without adding transport or OS mutation.

## 2026-10-05

- Clarified the separation between the browser host and native whole-PC agent.
- Added a persisted PC browser host for the host-neutral optimizer client.
- Added guarded browser capability detection shared by PC and Foundry hosts.
- Added an explicit local runtime-adapter boundary for approved actions.
- Added contract tests for environment probes, refusal behavior, persistence,
  action application, factories, and singleton lifecycle.
- Added the PC-wide typed local mesh with lazy node loading and trigger-based
  command/event routes for all optimizer engines and turbo libraries.
- Added the exact mesh gate at 100/100/100/100; pending Odinn sign-off.
