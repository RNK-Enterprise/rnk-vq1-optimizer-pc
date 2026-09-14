# Vendored VQ Optimizer Core

These files are **vendored copies** of the dual-stack optimizer core from the
`Vq Build` workspace (`../Vq Build/src`), so the Foundry module ships as a
self-contained package with no cross-checkout imports:

| Vendored file | Source | Purpose |
| ------------- | ------ | ------- |
| `protocol.js` | `src/_meta/protocol.js` | Protocol version, action allow-list, bounds, validators |
| `client.js` | `src/optimizer/client.js` | Host-neutral optimizer client (metrics → plan → apply → report) |
| `persistence/storage.js` | `src/optimizer/persistence/storage.js` | Storage backends + versioned record validation |
| `persistence/mixin.js` | `src/optimizer/persistence/mixin.js` | `withPersistence` host wrapper |
| `persistence/index.js` | `src/optimizer/persistence/index.js` | Barrel re-exports |

Only the relative import paths were adjusted. **Do not edit these files by
hand** — change the source in `Vq Build` and re-vendor, so both stacks stay
identical. The module-specific glue (Foundry host adapter, environment
builder, UI wiring) lives outside this folder.
