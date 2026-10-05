# PC browser integration

The PC surface uses the same host-neutral optimizer client as the Foundry
module. It is intended for a browser application running on a PC, including a
Foundry client when the application needs a standalone PC-facing control
surface.

## Integration

```js
import { createPcOptimizer } from '../scripts/pc-host.js';

const optimizer = createPcOptimizer({
  serverUrl: '/optimizer/v1/plan',
  hostOptions: {
    runtimeAdapter: {
      async apply(action, environment) {
        // Connect only the approved action types to the local application.
        // The host has already validated the action and its numeric bounds.
        localPerformanceController.apply(action, environment);
      }
    }
  }
});

runButton.addEventListener('click', () => optimizer.client.run());
```

The adapter is optional. Without one, validated actions are retained in the
host state so the embedding application can consume `host.getAppliedState()`.
The client uses browser `localStorage` by default and falls back to memory when
browser storage is unavailable.

## Boundaries

- Server responses are data-only plans. The client validates the protocol,
  action allow-list, and bounds before applying anything.
- PC support targets the embedding browser application. It does not execute
  shell commands, alter arbitrary processes, or claim operating-system tuning.
- Metrics are consent-aware and bounded. Missing browser signals remain null or
  false; the host never invents hardware or network facts.
- Execution is trigger-based. A host application decides when to call
  `client.run()`; this integration does not install a polling loop.

