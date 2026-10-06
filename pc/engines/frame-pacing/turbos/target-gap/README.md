# Frame Pacing: Target Gap Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo measures FPS shortfall against an explicit target and classifies healthy, elevated, and critical persistence bands. It is lazy-loaded by the frame-pacing catalog and fires only on the four declared frame-pacing triggers. It never invents or changes caps, display policy, files, or transport.
