/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * vq-cluster-auth contract tests - the shared suite from
 * @rnk/vq-contract-tests, run against EACH stack's own copy of
 * vq-cluster-auth.js. If a stack's copy drifts from the contract (or
 * from the other stack), this file goes red.
 */

import { registerAuthSuite } from '@rnk/vq-contract-tests';

registerAuthSuite(
  'vq-cluster-auth contract - VQ 1 auth copy',
  () => import('../../VQ 1/vq-cluster-auth.js')
);

registerAuthSuite(
  'vq-cluster-auth contract - VQ 2 auth copy',
  () => import('../../VQ 2/vq-cluster-auth.js')
);
