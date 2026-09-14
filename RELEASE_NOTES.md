# Release Notes — v3.1.0-rc1 (review candidate)

**Status: internal review candidate. NOT published.** This snapshot exists so
the release audit (hostile review, clean-room clone, benchmark verification,
license/provenance sweep, claims audit) can run against a fixed, tagged state.

## Headline: the core is now host-neutral

The central architectural claim — the optimizer engine is a general-purpose
component rather than a Foundry tool with renamed internals — is now enforced
in code:

- `scripts/optimizer-core.js` contains **zero** Foundry references. All world
  access goes through two injected interfaces: `DocumentSource` (messages,
  combats, packs, GM check, batched deletes) and `PerformanceProvider`
  (`previewChanges`/`apply`).
- `scripts/foundry-document-source.js` is the single Foundry adapter. It is a
  deliberate pass-through layer: errors propagate to the core, which owns
  error policy (declared in an `ERROR POLICY` header comment and accepted by
  the structural tests).
- The same production adapter drives the unit tests, and the reproducible
  benchmark drives the core through a plain in-memory fake — two independent
  hosts on the identical public surface.

## License and provenance

- License changed PROPRIETARY → **GPL-3.0-only**.
  - `LICENSE` is the canonical FSF text, byte-identical to
    https://www.gnu.org/licenses/gpl-3.0.txt (md5
    `1ebbd3e34237af26da5dc08a4e440464` verified at fetch time).
  - 40 source/doc files re-stamped; `test/optimizer.test.js` now *asserts*
    GPL headers and the absence of `PROPRIETARY AND CONFIDENTIAL` in
    `scripts/`, so license drift fails CI.
  - `package.json`/`package-lock.json` declare `GPL-3.0-only`.
- `packages/vq-contract-tests` is vendored at `vendor/vq-contract-tests`
  (provenance in `vendor/VENDORED.md`; license re-stamped, no functional
  changes). A fresh clone now runs `npm install && npm test` standalone; the
  dependency points at the vendored copy, not a private workspace.
- `scripts/vq/` (vendored from the `Vq Build` workspace) documents its
  provenance and license in `scripts/vq/README.md`.
- Residual scan: `PROPRIETARY AND CONFIDENTIAL` appears nowhere in the repo
  except (a) the test that enforces its absence and (b) third-party entries
  inside `package-lock.json`.

## Claims audit

- The static benchmark claims (`< 10ms` dry run, `< 500ms` optimize, `< 2MB`
  overhead, `< 50ms` component load) and the unverifiable v2.0.0 comparison
  percentages (85%/40%/60%) were **removed** from the README.
- Replaced with `npm run bench` (`scripts/benchmark-core.js`): a reproducible
  benchmark over the canonical workload (1000 messages, 50 combats, 100
  packs) with warmup runs discarded and p50/p95 over 30 measured runs,
  machine-readable via `-- --json`. The README table labels its numbers as a
  reference output on one machine, not a guarantee.

## Verification at tag time

- Unit suite: 626/626 passing; 100% statements/branches/functions/lines on
  all coverage-gated modules.
- Nightly real-tree contract suite: 16/16 against the actual VQ 1 / VQ 2
  stacks, including the stack-parity gate.
- ESLint clean; caniuse-lite data refreshed (`npx
  update-browserslist-db@latest`).
- RNK standards: no file in `scripts/` exceeds 500 lines (enforced by test).

## Known gaps carried forward (from ARCHITECTURE.md)

- VQ unit reference builds remain outside this repo; the unit protocol
  contract is what they must satisfy.
- Proxy request timeout (6s) is conservative and not yet per-command
  configurable.
- `updateMetrics` in the browser bridge attributes requests to VQ1/VQ2 by
  name-substring; replace with explicit unit ids when the unit builds land.

## Security review (completed after the initial RC tag)

A hostile review with live proof-of-concept attacks against the proxy and
gateway found and fixed seven issues (see [SECURITY_REVIEW.md](SECURITY_REVIEW.md)):
unauthenticated WS/gateway access by default, unbounded WS frames,
topology disclosure, attacker-controlled requestId echo, dispatch
amplification, and internal error leakage. The entry point now refuses to
start without explicit shared tokens. Failure-injection tests
(`test/failure-injection.test.js`, 18 cases) cover the dispatch/failover
failure paths. Clean-room clone verification: fresh `git clone` +
`npm install` + `npm test` (504 passed, real-stack suites skip visibly) +
`npm run bench` reproduces the README table.

## Not yet done (audit agenda, not RC blockers)

- Independent reproduction of the benchmark table on other hardware.
- Optional hardening: per-connection message rate limiting; explicit
  loopback bind for deployments that allow it (see SECURITY_REVIEW.md).

## How to verify this snapshot

```bash
npm install
npm test          # 626 tests + coverage gate + parity pretest
npm run bench     # reproduce the performance table
npm run test:nightly   # real-tree contract (requires VQ 1 / VQ 2 installs)
```
