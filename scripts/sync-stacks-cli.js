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
 * CLI: copy changed shared files from VQ 1 into VQ 2 (the canonical
 * direction). Companion to npm run parity - parity detects drift, this
 * repairs it.
 *
 *   node scripts/sync-stacks-cli.js              # copy VQ 1 -> VQ 2
 *   node scripts/sync-stacks-cli.js --dry-run    # print the plan, write nothing
 *   node scripts/sync-stacks-cli.js --reverse    # copy VQ 2 -> VQ 1
 *   npm run sync-stacks
 * Exits 1 on problems (missing source files).
 */
import { syncStacks, formatSyncReport } from './sync-stacks.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const reverse = args.includes('--reverse');

const report = syncStacks({ dryRun, reverse });
console.log(formatSyncReport(report, { dryRun, reverse }));
process.exit(report.ok ? 0 : 1);
