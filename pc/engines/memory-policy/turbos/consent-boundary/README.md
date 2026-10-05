# Memory Policy Consent-Boundary Turbo and Library

Status: implementation complete locally; pending Odinn sign-off.

This turbo observes proposed memory-policy changes, explicit consent, and
destructive-action requests. It distinguishes aligned consent, required
consent, blocked destructive actions, missing requests, invalid evidence, and
insufficient observation.

The turbo never approves or applies policy changes. It does not change
swappiness, reclaim memory, clear caches, touch files, alter settings, open
sockets, or use HTTP, REST, or API transport. It fires only on system-facts,
workload, and health triggers and keeps its sample window bounded.

The dedicated library validates consent reports, merges bounded counts, and
builds environment-aware observation plans and immutable local envelopes. It
does not import the turbo or approve policy changes.

Both components are analysis-only. Their future mesh endpoint is a separate
integration step.
