# PC optimizer client core

These files contain the bounded client protocol used by the PC browser host.
The client validates data-only plans, collects consent-aware metrics, and
delegates approved actions to the PC host:

| File | Purpose |
| ------------- | ------- |
| `protocol.js` | Protocol version, action allow-list, bounds, validators |
| `client.js` | PC optimizer client (metrics -> plan -> apply -> report) |
| `persistence/storage.js` | Browser storage and versioned record validation |
| `persistence/mixin.js` | `withPersistence` PC host wrapper |
| `persistence/index.js` | Barrel re-exports |

The PC host-specific glue lives in `scripts/pc-host.js` and
`scripts/browser-environment.js`.

**License:** these vendored files are distributed under GPL-3.0-only, the
same license as the rest of this repository (see [LICENSE](../../LICENSE)).
