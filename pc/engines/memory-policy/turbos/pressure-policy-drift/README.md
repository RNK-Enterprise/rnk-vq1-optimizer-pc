# Memory Policy Pressure-Policy-Drift Turbo and Library

Status: implementation complete locally; pending Odinn sign-off.

The turbo classifies bounded memory-pressure and recommended-policy
transitions as stable, escalating, recovering, or churning. Unknown and
out-of-range evidence remain explicit refusal states.

The dedicated library validates those reports, merges bounded counts, and
builds environment-aware observation plans and immutable local envelopes. It
does not import the turbo, change policy, access files, or open transport.

Both components are analysis-only. They do not change memory policy, reclaim
memory, clear caches, touch user files, alter settings, open sockets, or use
HTTP, REST, or API transport. Policy application and consent remain outside
this boundary; its future mesh endpoint is a separate integration step.
