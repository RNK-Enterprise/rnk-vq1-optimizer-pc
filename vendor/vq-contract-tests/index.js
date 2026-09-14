/**
 * RNK Vortex System Optimizer (vendored component)
 * Copyright © 2025 Asgard Innovations / RNK™
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/gpl-3.0.html>.
 *
 * @rnk/vq-contract-tests - shared behavioral contract suites for the VQ
 * stacks' duplicated modules.
 *
 * Consuming projects register the suites against their own copies:
 *
 *   // tests/vq-contract.test.js
 *   import { registerRuntimeSuite, registerAuthSuite, registerUnitServerSuite } from '@rnk/vq-contract-tests';
 *   import path from 'path';
 *   import { fileURLToPath } from 'url';
 *
 *   // npm scripts run with cwd = the stack root; no import.meta here:
 *   // Jest's CJS transform throws on it (see TANDEM_CLUSTER.md notes).
 *   const stackRoot = process.cwd();
 *
 *   registerRuntimeSuite('runtime contract', () => import('../vq-engine-runtime.js'));
 *   registerAuthSuite('auth contract', () => import('../vq-cluster-auth.js'));
 *   registerUnitServerSuite('unit server contract', stackRoot);
 *
 * See each factory's JSDoc in ./test-suite/ for parameters.
 */
export { registerRuntimeSuite, createFixtureStack, ENGINE_SRC } from './test-suite/vq-engine-runtime-suite.js';
export { registerAuthSuite } from './test-suite/vq-cluster-auth-suite.js';
export { registerUnitServerSuite } from './test-suite/vq-unit-server-suite.js';
// NOTE: makeJestContractConfig is NOT re-exported here on purpose - this
// barrel runs under Jest's babel transform, and jest.config.mjs (an .mjs
// file) would be required untransformed and crash. Import the config via
// the subpath export instead: '@rnk/vq-contract-tests/jest.config'.
