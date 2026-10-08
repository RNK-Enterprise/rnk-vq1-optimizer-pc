# PC optimizer security review

This review covers the public PC optimizer native agent, PC browser host,
platform adapters, cache boundaries, installers, and release workflow.

## Enforced boundaries

- Plans are data-only, allow-listed, bounded, expiring, and approval-gated.
- Native commands use `shell: false` and a scrubbed child environment.
- Remote optimizer gateways require HTTPS. HTTP is limited to exact loopback
  development hosts.
- Missing or malformed capabilities fail closed.
- The PC mesh is local and typed; it does not expose a listener or execute
  remote code.
- Optimizer-owned temporary files are distinct from platform and driver
  shader caches.
- Installers require an immutable ref and verify the resolved commit.

## Remaining evidence boundaries

Local tests and coverage are source-level evidence. They do not certify a
clean-machine install, Windows PowerShell execution, a live gateway, an
administrator-approved apply, or release sign-off. Those remain explicit
verification tasks for the target host and Odinn.

The host benchmark records observations and intentionally applies no system
actions. It is evidence for later decisions, not proof that an optimization
improved a host.
