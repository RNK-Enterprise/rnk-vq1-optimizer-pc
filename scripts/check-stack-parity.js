#!/usr/bin/env node
/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * CLI: verify VQ 1 and VQ 2 shared-module parity on disk.
 *   node scripts/check-stack-parity.js           # from Optimizer/
 *   npm run parity
 * Exits 1 when parity is broken (for CI and pre-commit hooks).
 */
import { checkParity, formatReport } from './stack-parity.js';

const report = checkParity();
console.log(formatReport(report));
process.exit(report.ok ? 0 : 1);
