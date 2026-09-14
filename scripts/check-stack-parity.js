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
 */
import { checkParity, formatReport } from './stack-parity.js';

const report = checkParity();
console.log(formatReport(report));
process.exit(report.ok ? 0 : 1);
