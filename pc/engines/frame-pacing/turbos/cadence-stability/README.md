# Frame Pacing: Cadence Stability Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo measures bounded frame-time cadence movement and classifies stable, observed-drift, and sustained-drift states. It is lazy-loaded by the frame-pacing catalog and fires only on the four declared frame-pacing triggers. It never changes display policy, FPS caps, files, or transport.
