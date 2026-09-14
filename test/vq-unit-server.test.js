/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
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
