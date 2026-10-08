# Release Notes — v3.1.0

Status: working release candidate. Odinn sign-off is still required before
this repository is called release-certified.

## PC release surface

- Added the native Windows/Linux whole-PC agent with preview-first execution.
- Added explicit `headless` and `interactive` installation modes.
- Added Node.js 20+ checks to both installers.
- Added explicit VQ gateway configuration for installer-time optimization.
- Kept administrative, destructive, cache, and organization operations behind
  separate approvals.
- Kept network behavior observational; no undocumented network tuning is
  applied.
- Kept the iOS path controller-only.
- Registered 34 engines, 34 engine libraries, 136 turbos, and 136 turbo
  libraries in the lazy, trigger-validated local PC mesh.

## Verification recorded for this checkout

- Full Jest suite: 361 suites and 2,121 tests passed.
- PC/native readiness suite: 352 suites and 1,600 tests passed.
- PC-tree coverage: 100% statements, branches, functions, and lines.
- ESLint passed.
- Native facts collection passed on the local Linux host.
- Cache and file-organization previews passed without applying changes.
- Linux installer shell syntax passed.

The Windows installer still requires a Windows PowerShell validation run. No
administrative action, destructive cache cleanup, file move, or live gateway
optimization was executed during this audit.

## Explicit boundaries

The current native adapters support documented power and process controls.
GPU policy, CPU affinity, memory policy, network tuning, and frame-rate
control remain unsupported results until platform-safe implementations and
live proof are added. The PC mesh is an in-process typed boundary; it does not
provide a public listener or arbitrary remote execution.

The installer pulls the repository from Git. The exact pushed commit must be
verified before a public install command is published. A clean-machine
installation and platform-specific apply proof are separate release gates.

## License and provenance

The project is GPL-3.0-only and attributed to Lisa's Dungeon. See `LICENSE`,
`NOTICE`, and `TRADEMARKS.md`. Every release change must remain committed in
this repository and must pass the RNK review requirements before publication.
