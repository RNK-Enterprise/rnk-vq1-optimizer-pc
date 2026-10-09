# PC integration

The native whole-PC agent under `native/` handles Windows/Linux/macOS facts,
process and power controls, storage pressure, workload policy, and explicit
cleanup or organization approvals. The public browser surface is limited to
the local media host below; it does not contain a remote optimizer client or
private stack protocol.

## Local music host

`scripts/pc-media-player.js` provides an application-owned browser music host
for user-selected `File` or `Blob` objects. It supports a bounded queue,
shuffle, repeat, next/previous, seek, and deterministic disposal of object URLs
through the host `HTMLAudioElement`. It never accepts remote URLs, arbitrary
filesystem paths, or downloads. Hosts without browser audio or object-URL
support return explicit `unsupported` evidence.

## Browser boundary

- The media host accepts only user-selected local `File` or `Blob` objects.
- It does not execute shell commands, alter processes, fetch remote URLs, or
  claim operating-system tuning.
- Unsupported browser APIs return explicit `unsupported` evidence.

For whole-PC changes, use the native CLI. The native path is preview-first and
keeps file organization outside automatic optimization.

## Local PC mesh

`pc/mesh.js` is the local typed mesh boundary for all PC engines, libraries,
and turbo libraries. It exposes command and event routes, lazy module loading,
and declared trigger paths.

The mesh is in-process only. It does not use HTTP, REST, sockets, public
listeners, or network mutation. Dispatch produces immutable review envelopes;
it does not execute operating-system actions.
