#!/usr/bin/env node
/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
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
