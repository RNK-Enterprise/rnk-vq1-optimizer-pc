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

Dedicated turbo/library pairs:

- `evidence-drift`: bounded documented, unverified, and unknown evidence history.
- `identity-completeness`: missing name, vendor, version, or evidence fields.
- `version-churn`: adjacent name/vendor/version changes.
- `inventory-drift`: additions and removals in the name/vendor identity set.

Each pair lazy-loads through its explicit local import boundary and fires only
on declared triggers. The family uses no HTTP, API, REST, socket, or public-listener
transport. These components observe facts and produce review plans; they do not
install, replace, load, tune, or mutate drivers, files, settings, or network state.
