#!/usr/bin/env node
/**
 * PC host benchmark command line entry point.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { runHostBenchmark } from './pc-host-benchmark.js';
import { pathToFileURL } from 'url';

export function parseBenchmarkArgs(argv = []) {
  const roundsArg = argv.find((value) => value.startsWith('--rounds='));
  const eventLoopArg = argv.find((value) => value.startsWith('--event-loop-samples='));
  return { json: argv.includes('--json'), rounds: roundsArg ? Number(roundsArg.slice('--rounds='.length)) : 3, eventLoopSamples: eventLoopArg ? Number(eventLoopArg.slice('--event-loop-samples='.length)) : 16 };
}

export async function runHostBenchmarkCli({ argv = process.argv.slice(2), benchmark = runHostBenchmark, write = (value) => process.stdout.write(value), errorWrite = (value) => process.stderr.write(value) } = {}) {
  const options = parseBenchmarkArgs(argv);
  try {
    const result = await benchmark({ repetitions: options.rounds, eventLoopSamples: options.eventLoopSamples });
    if (options.json) {
      write(`${JSON.stringify(result)}\n`);
    } else {
      write(`PC host benchmark (${result.platform})\n`);
      write(`Applied system actions: ${result.appliedSystemActions.length}\n`);
      for (const [domain, data] of Object.entries(result.domains)) write(`${domain}: ${data.decision}\n`);
    }
    return 0;
  } catch (error) {
    errorWrite(`${error.message}\n`);
    return 1;
  }
}

export async function runIfEntrypoint({ entrypoint, run = runHostBenchmarkCli } = {}) {
  if (!entrypoint) return 0;
  return run();
}

export function setExitCode(code, target = process) {
  if (code !== 0) target.exitCode = code;
  return code;
}

export function isEntrypoint(moduleUrl, executablePath) {
  return moduleUrl === pathToFileURL(executablePath || '').href;
}

const entrypoint = isEntrypoint(import.meta.url, process.argv[1]);
runIfEntrypoint({ entrypoint }).then((code) => setExitCode(code));
