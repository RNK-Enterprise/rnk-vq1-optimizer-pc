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
the existing explicit `--run-optimize` option is supplied.
