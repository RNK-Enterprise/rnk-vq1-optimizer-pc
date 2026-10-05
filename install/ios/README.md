# iOS controller path

iOS does not allow an installed third-party app or web page to tune the whole
device CPU, RAM, GPU, caches, or frame rate. The supported iOS role is a
controller: Safari or a future signed companion app can call an authenticated
HTTPS endpoint hosted by the Windows/Linux native agent.

The remote endpoint must keep the same boundaries as the local CLI:

- VQ returns data-only plans.
- The native agent validates plans and owns all operating-system commands.
- Every destructive action requires explicit approval.
- File organization remains a separate preview/confirm workflow.
- The iOS client must not receive shell commands, credentials, or arbitrary
  filesystem paths.

This directory documents the install boundary; it does not claim that an iOS
system optimizer has been installed.

