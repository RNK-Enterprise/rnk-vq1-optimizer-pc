/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
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
