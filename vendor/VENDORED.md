# Vendored components

## vq-contract-tests (`@rnk/vq-contract-tests` 1.0.0)

Shared behavioral contract suites for the VQ stacks' duplicated modules
(engine runtime, cluster auth, unit server): one contract, every stack,
drift fails CI.

- **Provenance:** vendored from the private `packages/vq-contract-tests`
  workspace into this repository so that a fresh clone can run
  `npm install && npm test` without access to private packages.
- **Upstream of record:** `packages/vq-contract-tests` (private workspace).
  Changes belong upstream first, then re-vendor here; do not edit this
  copy directly except to re-vendor.
- **License:** GPL-3.0-only, same as this repository. Headers were
  re-stamped during vendoring; no functional changes were made.
- **Consumed via:** `devDependencies` entry
  `"@rnk/vq-contract-tests": "file:vendor/vq-contract-tests"` and the
  stack-side parity manifest (`scripts/stack-parity.js`), whose contract
  test files import from this package.
