/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
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
 * Reproducible core benchmark.
 *
 * Drives the host-neutral OptimizerCore through an in-memory
 * DocumentSource with the workload sizes quoted in the README
 * (1000 chat messages, 50 combats, 100 compendium packs) and prints
 * machine-readable timings. No Foundry VTT installation is required;
 * the same public dependency-injection surface any other host would use
 * is what this script exercises.
 *
 * Usage:
 *   npm run bench              # human-readable summary
 *   npm run bench -- --json    # single JSON line (for artifact capture)
 *
 * Methodology notes:
 *   - warmup runs are executed and discarded before measurement
 *   - each sample is a fresh optimize() pass over the same workload
 *   - p50/p95 are computed over the measured samples
 *   - heap figures are process heapUsed deltas around the measured phase
 *     (best-effort in Node; browser heap metrics differ)
 */

import { performance } from 'perf_hooks';
import { OptimizerCore } from './optimizer-core.js';

const MESSAGE_COUNT = 1000;
const COMBAT_COUNT = 50;
const PACK_COUNT = 100;
const PACK_DOC_COUNT = 25;
const WARMUP_RUNS = 5;
const MEASURED_RUNS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function buildWorkload() {
  const now = Date.now();
  const messages = Array.from({ length: MESSAGE_COUNT }, (_, i) => ({
    id: `msg-${i}`,
    // Half the corpus is older than the 30-day retention window.
    timestamp: i % 2 === 0 ? now - 40 * DAY_MS : now - 1 * DAY_MS
  }));
  const combats = Array.from({ length: COMBAT_COUNT }, (_, i) => ({
    id: `combat-${i}`,
    // Two thirds are inactive with no turns (cleanup candidates).
    started: i % 3 !== 0,
    turns: i % 3 === 0 ? [] : [{ id: 't1' }]
  }));
  const packs = Array.from({ length: PACK_COUNT }, (_, i) => ({
    collection: `pack-${i}`,
    getIndex: async () => Array.from({ length: PACK_DOC_COUNT }, (_, d) => ({ id: `doc-${d}` }))
  }));
  return { messages, combats, packs };
}

function createInMemoryCore(workload, logFn = null) {
  const deleted = { messages: 0, combats: 0 };
  const core = new OptimizerCore({
    logFn,
    documentSource: {
      getMessages: () => workload.messages.slice(),
      deleteMessages: async (ids) => { deleted.messages += ids.length; },
      getCombats: () => workload.combats.slice(),
      deleteCombats: async (ids) => { deleted.combats += ids.length; },
      getPacks: () => workload.packs.slice(),
      isGM: () => true
    },
    performanceProvider: {
      previewChanges: () => [],
      apply: async () => {}
    }
  });
  return { core, deleted };
}

const OPTIONS = {
  doCleanupChat: true,
  chatRetentionDays: 30,
  doCleanupInactiveCombats: true,
  doRebuildCompendiumIndexes: true,
  doCorePerformanceTweaks: true
};

function percentile(samples, p) {
  const sorted = samples.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function measureModuleLoadTime() {
  // Dynamic imports on a cold module registry approximate the lazy-load
  // path the Foundry entry point uses.
  const t0 = performance.now();
  await import('./optimizer-core.js');
  await import('./settings-manager.js');
  await import('./performance-tweaks.js');
  return performance.now() - t0;
}

async function runBenchmark() {
  const workload = buildWorkload();

  for (let i = 0; i < WARMUP_RUNS; i++) {
    const { core } = createInMemoryCore(workload);
    await core.optimize(OPTIONS);
  }

  const dryRunSamples = [];
  const optimizeSamples = [];
  const deletedTotals = { messages: 0, combats: 0 };

  if (global.gc) global.gc();
  const heapBefore = process.memoryUsage().heapUsed;

  for (let i = 0; i < MEASURED_RUNS; i++) {
    const dryCore = createInMemoryCore(workload).core;
    let t0 = performance.now();
    await dryCore.dryRun(OPTIONS);
    dryRunSamples.push(performance.now() - t0);

    const { core, deleted } = createInMemoryCore(workload);
    t0 = performance.now();
    await core.optimize(OPTIONS);
    optimizeSamples.push(performance.now() - t0);
    deletedTotals.messages += deleted.messages;
    deletedTotals.combats += deleted.combats;
  }

  if (global.gc) global.gc();
  const heapDelta = process.memoryUsage().heapUsed - heapBefore;
  const loadMs = await measureModuleLoadTime();

  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const result = {
    meta: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      workload: {
        messages: MESSAGE_COUNT,
        combats: COMBAT_COUNT,
        packs: PACK_COUNT,
        docsPerPack: PACK_DOC_COUNT
      },
      warmupRuns: WARMUP_RUNS,
      measuredRuns: MEASURED_RUNS,
      date: new Date().toISOString()
    },
    dryRunMs: {
      avg: Math.round(avg(dryRunSamples) * 100) / 100,
      p50: Math.round(percentile(dryRunSamples, 50) * 100) / 100,
      p95: Math.round(percentile(dryRunSamples, 95) * 100) / 100
    },
    optimizeMs: {
      avg: Math.round(avg(optimizeSamples) * 100) / 100,
      p50: Math.round(percentile(optimizeSamples, 50) * 100) / 100,
      p95: Math.round(percentile(optimizeSamples, 95) * 100) / 100
    },
    moduleLoadMs: Math.round(loadMs * 100) / 100,
    heapDeltaBytes: heapDelta,
    deletedPerRun: {
      messages: deletedTotals.messages / MEASURED_RUNS,
      combats: deletedTotals.combats / MEASURED_RUNS
    }
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result));
  } else {
    console.log('RNK Vortex System Optimizer - core benchmark');
    console.log(`  node ${result.meta.node} on ${result.meta.platform}, ${result.meta.date}`);
    console.log(`  workload: ${MESSAGE_COUNT} messages, ${COMBAT_COUNT} combats, ${PACK_COUNT} packs x ${PACK_DOC_COUNT} docs`);
    console.log(`  runs: ${WARMUP_RUNS} warmup, ${MEASURED_RUNS} measured\n`);
    console.log(`  dryRun      avg ${result.dryRunMs.avg}ms  p50 ${result.dryRunMs.p50}ms  p95 ${result.dryRunMs.p95}ms`);
    console.log(`  optimize    avg ${result.optimizeMs.avg}ms  p50 ${result.optimizeMs.p50}ms  p95 ${result.optimizeMs.p95}ms`);
    console.log(`  module load (3 modules, dynamic import): ${result.moduleLoadMs}ms`);
    console.log(`  heapUsed delta over measured phase: ${result.heapDeltaBytes} bytes`);
    console.log(`  deletions per optimize run: ${result.deletedPerRun.messages} messages, ${result.deletedPerRun.combats} combats`);
    console.log('\nReproduce: npm run bench  (machine-readable: npm run bench -- --json)');
  }

  return result;
}

runBenchmark().catch((e) => {
  console.error(e);
  process.exit(1);
});
