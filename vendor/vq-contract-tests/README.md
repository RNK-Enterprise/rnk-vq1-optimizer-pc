# @rnk/vq-contract-tests

Shared behavioral contract suites for the RNK Vortex Quantum stacks'
duplicated modules. The VQ 1 and VQ 2 stacks ship their own copies of the
core modules (`vq-engine-runtime.js`, `vq-cluster-auth.js`,
`vq-unit-server.js`); this package holds ONE contract suite per module,
which every copy is held to. If any copy drifts — from the contract or
from its sibling stack — the consuming project's test run goes red.

## Exports

| Export | Suite | What it pins |
|---|---|---|
| `registerRuntimeSuite(label, importRuntime, stackRoot?)` | engine runtime | discovery, name resolution, invoke dispatch, jsonSafe results, instance pooling + config replacement, structured errors, per-call timeouts incl. the 60s clamp, 64-cap LRU eviction with destroy |
| `registerAuthSuite(label, importAuth)` | cluster auth | env token handling + warnings, timing-safe comparison edge cases, WS header/query extraction, HTTP bearer parsing, verify/open-mode semantics, loopback detection, real-socket integration |
| `registerUnitServerSuite(label, stackRootAbs)` | unit server | spawns the stack's real server on a free port: requestId echo (incl. error paths), unknown commands, proxy health contract, stats counter deltas, connection counting |
| `makeJestContractConfig(overrides?)` | jest config | babel ESM transform + `file://` mapper; spread into `jest.contract.config.js` |
| `createFixtureStack()`, `ENGINE_SRC` | helpers | the hermetic fixture stack used by the runtime suite |

## Consumer setup

```bash
npm install --save-dev file:../packages/vq-contract-tests
```

`tests/vq-contract.test.js`:

```js
import { registerRuntimeSuite, registerAuthSuite, registerUnitServerSuite } from '@rnk/vq-contract-tests';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const stackRoot = path.resolve(here, '..');

registerRuntimeSuite('runtime contract', () => import('../vq-engine-runtime.js'));
registerAuthSuite('auth contract', () => import('../vq-cluster-auth.js'));
registerUnitServerSuite('unit server contract', stackRoot);
```

`jest.contract.config.js`:

```js
import { makeJestContractConfig } from '@rnk/vq-contract-tests/jest.config';
export default makeJestContractConfig({ testMatch: ['<rootDir>/tests/**/*.test.js'] });
```

`package.json` script: `"test:contract": "jest -c jest.contract.config.js"`.

## Notes

- Suites are parameterized by *which module they import/spawn*, so one
  package serves every stack (and any future VQ-3).
- `registerUnitServerSuite` needs `ws` (peer dep) and spawns
  `node vq-unit-server.js` — the stack needs its dependencies installed.
- Suites that hit the filesystem skip themselves when the module under
  test is absent, so partial checkouts still run the suites that apply.
