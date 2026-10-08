# PC integration

The browser host under `scripts/pc-host.js` handles browser capabilities and
embedded applications. The native whole-PC agent under `native/` handles
Windows/Linux facts, process and power controls, and explicit cache cleanup.

## Integration

```js
import { createPcOptimizer } from '../scripts/pc-host.js';

const optimizer = createPcOptimizer({
  serverUrl: 'https://optimizer.example.invalid/v1/plan',
  hostOptions: {
    runtimeAdapter: {
      async apply(action, environment) {
        // Connect only approved action types to the local application.
        localPerformanceController.apply(action, environment);
      }
    }
  }
});

runButton.addEventListener('click', () => optimizer.client.run());
```

The adapter is optional. Without one, validated actions are retained in the
host state so the embedding application can consume
`host.getAppliedState()`. The client uses browser `localStorage` by default
and falls back to memory when browser storage is unavailable.

## Browser-host boundaries

- Server responses are data-only plans. The client validates the protocol,
  action allow-list, and bounds before applying anything.
- Browser support does not execute shell commands, alter arbitrary processes,
  or claim operating-system tuning.
- Metrics are consent-aware and bounded. Missing signals remain null or
  false; the host never invents hardware or network facts.
- Execution is trigger-based. A host application decides when to call
  `client.run()`; this integration does not install a polling loop.

For whole-PC changes, use the native CLI. The native path is preview-first and
keeps file organization outside automatic optimization.

## Local PC mesh

`pc/mesh.js` is the local typed mesh boundary for all PC engines, libraries,
and turbo libraries. It exposes command and event routes, lazy module loading,
and declared trigger paths.

The mesh is in-process only. It does not use HTTP, REST, sockets, public
listeners, or network mutation. Dispatch produces immutable review envelopes;
it does not execute operating-system actions.
