# Network Safety Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies explicit trust, encryption, and public-link evidence.
Untrusted or public unencrypted links become review evidence; missing facts
remain unknown.

It is observation-only. It does not change routes, DNS, MTU, QoS, firewalls,
files, or transport.

The dedicated library is `pc/engines/network-safety/library.js`. It classifies
normalized safety observations for the engine and remains observation-only.

Dedicated turbo/library pairs:

- `encryption-drift`: explicit encryption boolean changes and unknown evidence.
- `trust-drift`: explicit trust boolean changes and unknown evidence.
- `public-exposure`: explicit public-plus-unencrypted link evidence only.
- `safety-evidence`: review, observed, and unknown risk history.

Each pair lazy-loads through its explicit local import boundary and fires only
on declared triggers. The family uses no HTTP, API, REST, socket, or
public-listener transport and never mutates routes, DNS, MTU, QoS, interfaces,
firewalls, files, or network settings.
