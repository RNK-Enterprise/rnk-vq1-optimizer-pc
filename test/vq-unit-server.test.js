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

import path from 'path';
import fs from 'fs';
import { registerUnitServerSuite } from '@rnk/vq-contract-tests';

/** Jest normally runs with cwd = Optimizer/; tolerate project root too. */
function stackRoot(rel) {
  const a = path.resolve(process.cwd(), rel);
  return fs.existsSync(a) ? a : path.resolve(process.cwd(), '..', rel);
}

registerUnitServerSuite('vq-unit-server contract - VQ 1', stackRoot('VQ 1'));
registerUnitServerSuite('vq-unit-server contract - VQ 2', stackRoot('VQ 2'));
