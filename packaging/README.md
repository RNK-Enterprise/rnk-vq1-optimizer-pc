# Workstation runtime package

`npm run package:workstation -- --output /absolute/path --version 3.1.1`
builds a bounded runtime package for Windows, Linux, or macOS. The builder
copies the native authority, PC engines, package metadata, and safety
documentation, then writes one fixed dashboard launcher and a manifest with a
deterministic SHA-256 entry for every copied runtime file and launcher.

Select the platform explicitly when building for another host:

```text
node scripts/workstation-package.js --platform win32 --output C:\rnk\optimizer --version 3.1.1
node scripts/workstation-package.js --platform linux --output /opt/rnk-optimizer --version 3.1.1
node scripts/workstation-package.js --platform darwin --output /Applications/RNKOptimizer --version 3.1.1
```

The output is a runtime bundle, not a signed installer, service, daemon, or
tray application. The Windows launcher is a `.cmd` file. POSIX launchers use
`RNK_NODE` when set and otherwise resolve `node` from `PATH`. The dashboard
still uses the existing approval-gated snapshot and host opener boundary.

The source and output roots must be absolute and distinct. Output inside the
source tree is refused so a package cannot become an input to its own build.
Use an immutable signed release checkout for release packaging; a working tree
package is a local development artifact only.

Verify a copied bundle with:

```text
node scripts/workstation-package.js --verify --source /absolute/path/to/bundle
```

Verification refuses unsafe manifest paths, duplicate entries, missing or extra
files, and SHA-256 mismatches.

The signed-tag release workflow builds and verifies Linux, macOS, and Windows
runtime archives before publishing each archive with its SHA-256 sidecar. The
workflow still requires the repository signing key, an annotated signed tag,
and the release attestation path.
