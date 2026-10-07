/**
 * RNK Vortex System Optimizer
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
 *
 * vq-unit-server contract tests - the shared suite from
 * @rnk/vq-contract-tests, spawned against EACH stack's own
 * vq-unit-server.js (requestId echo, unknown commands, proxy health
 * contract, stats counter deltas).
 */

import { registerUnitServerSuite } from '@rnk/vq-contract-tests';
import {
  defaultStackRoot,
  hasCompleteStackPair,
  PRESENCE_FILES
} from '../scripts/stack-parity.js';

const STACK_A = defaultStackRoot('VQ 1');
const STACK_B = defaultStackRoot('VQ 2');
const COMPLETE_STACKS = hasCompleteStackPair(STACK_A, STACK_B, PRESENCE_FILES);

if (COMPLETE_STACKS) {
  registerUnitServerSuite('vq-unit-server contract - VQ 1', STACK_A);
  registerUnitServerSuite('vq-unit-server contract - VQ 2', STACK_B);
} else {
  describe('vq-unit-server contract', () => {
    test('SKIPPED: complete VQ stacks are not present', () => {
      expect(true).toBe(true);
    });
  });
}
