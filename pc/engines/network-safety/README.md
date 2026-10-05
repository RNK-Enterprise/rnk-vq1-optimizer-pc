# Network Safety Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies explicit trust, encryption, and public-link evidence.
Untrusted or public unencrypted links become review evidence; missing facts
remain unknown.

It is observation-only. It does not change routes, DNS, MTU, QoS, firewalls,
files, or transport.

The dedicated library is `pc/engines/network-safety/library.js`. It classifies
normalized safety observations for the engine and remains observation-only.
