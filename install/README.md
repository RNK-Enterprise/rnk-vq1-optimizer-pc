# PC installation

The Linux and Windows installers clone or update the optimizer directly from
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

The installers require Node.js 20 or newer, Git, and npm. A fresh install uses
the public optimizer repository by default; pass `--repo URL` on Linux or
`-RepositoryUrl URL` on Windows to use another source.

Optimization requires the configured VQ gateway. Set
`OPTIMIZER_GATEWAY_URL` or pass `--gateway URL` on Linux / `-GatewayUrl URL` on
Windows. If `--run-optimize` or `-RunOptimize` is requested without a gateway,
the installer stops before cloning or changing the installation directory.

Examples:

```bash
./install/linux/install.sh --mode interactive
./install/linux/install.sh --mode headless --run-optimize \
  --gateway https://optimizer.example.invalid/v1/plan
```

```powershell
.\install\windows\install.ps1 -EnvironmentMode interactive
.\install\windows\install.ps1 -EnvironmentMode headless -RunOptimize \
  -GatewayUrl https://optimizer.example.invalid/v1/plan
```
