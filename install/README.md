# PC installation

The Linux, macOS, and Windows installers clone or update the optimizer directly from
Git. Before any clone, update, dependency installation, or facts collection,
they require the user to select an environment mode:

- `headless` keeps operation CLI-first and does not assume a desktop session.
- `interactive` permits desktop-oriented control while retaining preview-first
  operation and explicit approval for administrative or destructive actions.

Use `--mode headless` or `--mode interactive` for unattended installation.
Without that flag, a terminal prompt is shown in bold. A non-interactive shell
must provide the flag and will fail closed when it is absent.

The selected mode is stored in the optimizer application configuration area,
not in the Git checkout. Installation does not apply an optimization unless
the explicit `--run-optimize` option is supplied.

Installers refuse before cloning or dependency installation when the target
volume is below the free-space floor. The default is 5 GiB; Linux and macOS
accept `--min-free-bytes BYTES`, and Windows accepts `-MinimumFreeBytes BYTES`.

Annotated release tags require the exact RNK signing fingerprint. Set
`RNK_SIGNING_KEY_FINGERPRINT` or pass `--signing-fingerprint FINGERPRINT` on
Linux/macOS, or `-ExpectedSigningFingerprint FINGERPRINT` on Windows. The
installer requires that key in the local GPG keyring, verifies the tag signer,
and fails closed when the fingerprint is missing or mismatched. The actual RNK
fingerprint must be supplied by the release owner; this repository does not
invent or substitute one.

Production installs run `npm ci --omit=dev`; Jest, Babel, ESLint, and other
development-only packages are not installed into the runtime directory.

The installers require Node.js 20 or newer, Git, and npm. A fresh install uses
the public optimizer repository by default; pass `--repo URL` on Linux or
`-RepositoryUrl URL` on Windows to use another source.

Optimization requires the configured optimizer gateway. Set
`OPTIMIZER_GATEWAY_URL` or pass `--gateway URL` on Linux / `-GatewayUrl URL` on
Windows. If `--run-optimize` or `-RunOptimize` is requested without a gateway,
the installer stops before cloning or changing the installation directory.

Windows performs a live, read-only gateway verification before the optimization
preview. An administrative apply is separate: it requires an elevated
PowerShell session, `-ApplyOptimize`, and `-AllowAdmin`; destructive actions
must also be named with `-Approve`. Use `-RequireRog` to require an observed
ASUS ROG host identity.

Examples:

```bash
./install/linux/install.sh --mode interactive
./install/linux/install.sh --mode headless --run-optimize \
  --gateway https://optimizer.example.invalid/v1/plan
./install/linux/install.sh --mode headless --min-free-bytes 1073741824
./install/linux/install.sh --mode headless --ref v3.1.3 \
  --signing-fingerprint RNK_SIGNING_FINGERPRINT
```

```powershell
.\install\windows\install.ps1 -EnvironmentMode interactive
.\install\windows\install.ps1 -EnvironmentMode headless -RunOptimize \
  -GatewayUrl https://optimizer.example.invalid/v1/plan
.\install\windows\install.ps1 -EnvironmentMode headless -MinimumFreeBytes 1073741824
.\install\windows\install.ps1 -EnvironmentMode interactive -InstallDirectory E:\RNK-Vortex-Optimizer -Ref v3.1.3 `
  -ExpectedSigningFingerprint RNK_SIGNING_FINGERPRINT
.\install\windows\install.ps1 -EnvironmentMode interactive -InstallDirectory E:\RNK-Vortex-Optimizer -Ref v3.1.3 -RequireRog
.\install\windows\install.ps1 -EnvironmentMode interactive -Ref v3.1.3 -RunOptimize `
  -GatewayUrl https://optimizer.example.invalid/v1/plan -ApplyOptimize -AllowAdmin
```

```bash
./install/macos/install.sh --mode interactive --ref v3.1.3 \
  --signing-fingerprint RNK_SIGNING_FINGERPRINT
./install/macos/install.sh --mode headless --ref v3.1.3
```
