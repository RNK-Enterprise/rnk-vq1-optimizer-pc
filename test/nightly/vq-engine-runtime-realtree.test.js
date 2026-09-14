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
 * Nightly entry point: registers the real-tree runtime suite once per
 * stack, against each stack's own vq-engine-runtime.js copy. Excluded
 * from the main Jest run (see jest.nightly.config.js); scheduled by
 * .github/workflows/nightly.yml and runnable via `npm run test:nightly`.
 */

import fs from 'fs';
import path from 'path';
import { registerRealTreeSuite } from './shared/vq-engine-runtime-realtree-suite.js';

/** Jest normally runs with cwd = Optimizer/; tolerate project root too. */
function stackRoot(rel) {
  const a = path.resolve(process.cwd(), rel);
  if (fs.existsSync(a)) return a;
  return path.resolve(process.cwd(), '..', rel);
}

registerRealTreeSuite('real tree - VQ 1 runtime copy', stackRoot('VQ 1'), () => import('../../../VQ 1/vq-engine-runtime.js'), {
  minDiscovered: 900,
  minLoadable: 900
});

registerRealTreeSuite('real tree - VQ 2 runtime copy', stackRoot('VQ 2'), () => import('../../../VQ 2/vq-engine-runtime.js'), {
  minDiscovered: 900,
  minLoadable: 900
});
