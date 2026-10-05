# Driver Capability Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies documented, unverified, and unknown driver evidence and
preserves vendor/version details for review. It does not infer that a driver
may be installed, replaced, loaded, or tuned.

It is analysis-only. It does not change drivers, files, settings, or
transport.

The dedicated library is `pc/engines/driver-capability/library.js`. It
classifies normalized driver observations for the engine and remains
analysis-only.
