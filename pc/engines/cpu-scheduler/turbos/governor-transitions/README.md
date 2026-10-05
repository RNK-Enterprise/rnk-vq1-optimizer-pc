# CPU Scheduler Governor-Transitions Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo observes normalized governor changes and load alignment across a
bounded sample window. It classifies stable governors, powersave under load,
frequent transitions, transition watch, insufficient evidence, and missing
observations.

It is analysis-only. It never changes frequency, scheduler policy, process
priority, affinity, files, settings, or transport state. It is lazy and
trigger-driven.

Its dedicated `library.js` validates governor reports, merges weighted
transition evidence, builds environment-aware observation plans, and creates
immutable local envelopes without importing the turbo implementation.
