#!/usr/bin/env node
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
 * CLI: verify VQ 1 and VQ 2 shared-module parity on disk.
 *   node scripts/check-stack-parity.js           # from Optimizer/
 *   npm run parity
 * Exits 1 when parity is broken (for CI and pre-commit hooks).
 *
 * The parity gate is only meaningful inside the full RNK workspace, where
 * the private VQ 1 / VQ 2 stacks live next to this repository. In a
 * standalone clone (the normal open-source checkout) the stacks do not
 * exist, so the gate skips instead of failing - drift detection between
 * the stacks is a workspace concern, not a module concern.
 */
import fs from 'fs';
import path from 'path';
import { checkParity, formatReport, defaultStackRoot } from './stack-parity.js';

const stackA = defaultStackRoot('VQ 1');
const stackB = defaultStackRoot('VQ 2');

if (!fs.existsSync(stackA) || !fs.existsSync(stackB)) {
  console.log('Stack parity SKIPPED: VQ 1 / VQ 2 stacks not present (standalone checkout).');
  console.log('The parity gate applies inside the full RNK workspace only.');
  process.exit(0);
}

const report = checkParity();
console.log(formatReport(report));
process.exit(report.ok ? 0 : 1);
