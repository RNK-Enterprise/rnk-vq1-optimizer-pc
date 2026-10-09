/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Per-file coverage gate. Jest's global threshold is necessary but cannot
 * prevent one file from hiding behind another file's excess coverage.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const METRICS = Object.freeze(['statements', 'branches', 'functions', 'lines']);

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function countsFor(metric, data) {
  if (metric === 'statements') return Object.values(data.s || {});
  if (metric === 'functions') return Object.values(data.f || {});
  if (metric === 'branches') return Object.values(data.b || {}).flatMap((counts) => Array.isArray(counts) ? counts : [counts]);
  const lineCounts = new Map();
  Object.entries(data.statementMap || {}).forEach(([id, location]) => {
    const line = Number(location?.start?.line);
    if (!Number.isInteger(line) || line < 1) return;
    lineCounts.set(line, Math.max(lineCounts.get(line) || 0, Number(data.s?.[id]) || 0));
  });
  return [...lineCounts.values()];
}

function failuresForFile(filePath, data) {
  if (!record(data)) return [{ filePath, metric: 'file', reason: 'coverage record is missing' }];
  return METRICS.flatMap((metric) => {
    const counts = countsFor(metric, data);
    if (!counts.length) return [{ filePath, metric, reason: 'coverage metric is missing' }];
    const uncovered = counts.filter((count) => !Number.isFinite(count) || count < 1).length;
    return uncovered ? [{ filePath, metric, uncovered, total: counts.length }] : [];
  });
}

export function findCoverageFailures(coverage) {
  if (!record(coverage)) throw new TypeError('Coverage data must be an object');
  return Object.entries(coverage).flatMap(([filePath, data]) => failuresForFile(filePath, data));
}

export function isCoverageEntrypoint(moduleUrl, argvPath) {
  return path.resolve(argvPath || '') === path.resolve(fileURLToPath(moduleUrl));
}

export async function verifyCoverageFile(filePath, { fsImpl = fs } = {}) {
  const contents = await fsImpl.readFile(filePath, 'utf8');
  let coverage;
  try {
    coverage = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Coverage data is not valid JSON: ${error.message}`);
  }
  const failures = findCoverageFailures(coverage);
  if (failures.length) {
    const details = failures.map((failure) => `${failure.filePath} ${failure.metric}${failure.uncovered ? ` (${failure.uncovered}/${failure.total} uncovered)` : `: ${failure.reason}`}`).join('\n');
    throw new Error(`Per-file coverage gate failed:\n${details}`);
  }
  return Object.freeze({ state: 'passed', files: Object.keys(coverage).length, metrics: [...METRICS] });
}

export async function runCoverageEntrypoint({ entrypoint, filePath, verifier = verifyCoverageFile, write = (value) => process.stdout.write(value), writeError = (value) => process.stderr.write(value) } = {}) {
  if (!entrypoint) return Object.freeze({ state: 'skipped' });
  try {
    const result = await verifier(filePath);
    write(`Per-file coverage: ${result.files} files at 100/100/100/100\n`);
    return result;
  } catch (error) {
    writeError(`${error.message}\n`);
    return Object.freeze({ state: 'error', reason: error.message });
  }
}

export function setCoverageExitCode(result, target = process) {
  if (result?.state === 'error') target.exitCode = 1;
  return result;
}

runCoverageEntrypoint({
  entrypoint: isCoverageEntrypoint(import.meta.url, process.argv[1]),
  filePath: path.resolve(process.cwd(), 'coverage', 'coverage-final.json')
}).then((result) => setCoverageExitCode(result));
