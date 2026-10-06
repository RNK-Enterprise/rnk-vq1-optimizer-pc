# Frame Pacing: Jitter Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo measures bounded frame-time variance movement and explicit headless, disabled-observation, and incomplete-evidence boundaries. It is lazy-loaded by the frame-pacing catalog and fires only on the four declared frame-pacing triggers. It never changes display policy, FPS caps, files, or transport.
