#!/usr/bin/env node
/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * Nightly runner: parity gate -> nightly Jest (real-tree runtime suites).
 *   node scripts/run-nightly.js           # from Optimizer/
 *   npm run test:nightly
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM: derive the Optimizer root from this file's URL (no __dirname).
const optimizerRoot = path.dirname(fileURLToPath(import.meta.url));

console.log('=== VQ Nightly: real-tree runtime contract ===\n');

// 0) The heavy suites import real engine modules whose deps live in each
//    stack's node_modules - make sure they are installed before running.
for (const stack of ['../../VQ 1', '../../VQ 2']) {
  const nm = path.resolve(optimizerRoot, stack, 'node_modules');
  if (!fs.existsSync(nm)) {
    console.error(`[nightly] ${stack} has no node_modules - run "npm install" in that stack first.`);
    process.exit(1);
  }
}

// 1) Parity gate: a drifted shared module invalidates nightly results.
console.log('[nightly] parity gate...');
const parity = spawnSync('node', ['scripts/check-stack-parity.js'], { stdio: 'inherit' });
if (parity.status !== 0) {
  console.error('[nightly] parity FAILED - sync the stacks before trusting nightly results.');
  process.exit(1);
}

// 2) The real-tree suites.
console.log('\n[nightly] running real-tree suites...\n');
const jest = spawnSync('npx', ['jest', '-c', 'jest.nightly.config.js', '--runInBand'], {
  stdio: 'inherit'
});

process.exit(jest.status ?? 1);
