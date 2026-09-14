/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * VQEngineRuntime contract tests - the shared suite from
 * @rnk/vq-contract-tests, run against EACH stack's own copy of
 * vq-engine-runtime.js. If a stack's copy drifts from the contract (or
 * from the other stack), this file goes red.
 */

import { registerRuntimeSuite } from '@rnk/vq-contract-tests';

registerRuntimeSuite(
  'VQEngineRuntime contract - VQ 1 runtime copy',
  () => import('../../VQ 1/vq-engine-runtime.js')
);

registerRuntimeSuite(
  'VQEngineRuntime contract - VQ 2 runtime copy',
  () => import('../../VQ 2/vq-engine-runtime.js')
);
