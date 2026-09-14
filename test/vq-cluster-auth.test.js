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
 * vq-cluster-auth contract tests - the shared suite from
 * @rnk/vq-contract-tests, run against EACH stack's own copy of
 * vq-cluster-auth.js. If a stack's copy drifts from the contract (or
 * from the other stack), this file goes red.
 */

import fs from 'fs';
import path from 'path';
import { registerAuthSuite } from '@rnk/vq-contract-tests';

// Contract suites import the real stack copies, which only exist inside
// the full RNK workspace. In a standalone clone, skip - the same suites
// run for real in the nightly real-tree pass.
const STACKS_PRESENT = ['VQ 1', 'VQ 2'].every((dir) =>
  fs.existsSync(path.resolve(process.cwd(), dir))
  || fs.existsSync(path.resolve(process.cwd(), '..', dir)));

if (STACKS_PRESENT) {
  registerAuthSuite(
    'vq-cluster-auth contract - VQ 1 auth copy',
    () => import('../../VQ 1/vq-cluster-auth.js')
  );

  registerAuthSuite(
    'vq-cluster-auth contract - VQ 2 auth copy',
    () => import('../../VQ 2/vq-cluster-auth.js')
  );
} else {
  describe('vq-cluster-auth contract', () => {
    test('SKIPPED: VQ stacks not present (standalone checkout)', () => {
      expect(true).toBe(true);
    });
  });
}
