#!/usr/bin/env node
/**
 * PC host benchmark command line entry point.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { runHostBenchmark } from './pc-host-benchmark.js';

const json = process.argv.includes('--json');
const roundsArg = process.argv.find((value) => value.startsWith('--rounds='));
const eventLoopArg = process.argv.find((value) => value.startsWith('--event-loop-samples='));
const rounds = roundsArg ? Number(roundsArg.slice('--rounds='.length)) : 3;
const eventLoopSamples = eventLoopArg ? Number(eventLoopArg.slice('--event-loop-samples='.length)) : 16;

try {
  const result = await runHostBenchmark({ repetitions: rounds, eventLoopSamples });
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(`PC host benchmark (${result.platform})\n`);
    process.stdout.write(`Applied system actions: ${result.appliedSystemActions.length}\n`);
    for (const [domain, data] of Object.entries(result.domains)) {
      process.stdout.write(`${domain}: ${data.decision}\n`);
    }
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
