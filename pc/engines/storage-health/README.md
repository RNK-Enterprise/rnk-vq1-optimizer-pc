# Storage Health Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies bounded storage occupancy, read-only status, and
optional healthy/degraded/failed labels. It distinguishes capacity review
from data-protection review and keeps unknown health evidence visible.

It is analysis-only. It does not repair, remount, delete, organize, modify
files, or open transport.

The dedicated `library.js` classifies occupancy and health evidence, compares
storage snapshots, and emits immutable local review envelopes without storage
mutation.
