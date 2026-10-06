# PC integration

The repository has two separate PC surfaces. The browser host under
`scripts/pc-host.js` is for browser capabilities and embedded applications.
The native whole-PC agent under `native/` is for Windows/Linux CPU, memory,
GPU observation, process controls, power controls, and explicit cache cleanup.
Neither surface is the Foundry module.

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

## Browser-host boundaries

- Server responses are data-only plans. The client validates the protocol,
  action allow-list, and bounds before applying anything.
- Browser support targets the embedding application. It does not execute shell
  commands, alter arbitrary processes, or claim operating-system tuning.
- Metrics are consent-aware and bounded. Missing browser signals remain null or
  false; the host never invents hardware or network facts.
- Execution is trigger-based. A host application decides when to call
  `client.run()`; this integration does not install a polling loop.

For actual whole-PC changes, use the native CLI and its platform adapter. The
native path is preview-first and keeps file organization outside automatic
optimization.

## Local PC mesh

`pc/mesh.js` is the local typed mesh boundary for all 34 PC engines, their 34
dedicated libraries, and all 136 turbo/library pairs. It exposes command and
event routes, lazy module loading, and the four declared trigger paths.

The mesh is in-process only. It does not use HTTP, REST, sockets, public
listeners, or network mutation. Dispatch produces immutable review envelopes;
it does not execute optimizer actions. The mesh can lazily execute an engine's
analysis function through a validated trigger; engine results remain
analysis-only and the native adapter remains the sole OS-action authority.
