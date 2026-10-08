/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated counter-integrity library. It validates, aggregates, and plans
 * VRAM counter reports without importing the turbo or changing memory policy.
 */

export const GPU_COUNTER_INTEGRITY_LIBRARY_ID = 'gpu-memory.counter-integrity.library';
export const GPU_COUNTER_INTEGRITY_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'inconsistent-counters-sustained',
  'inconsistent-counters-observed',
  'consistent-counters',
  'invalid-vram-evidence',
  'incomplete-vram-evidence',
  'no-gpu',
  'no-observation',
  'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value, lower, upper) {
  return Number.isFinite(value) && value >= lower && value <= upper;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Counter-integrity library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Counter-integrity library report must be an object');
  if (report.turbo !== 'gpu-memory.counter-integrity') {
    throw new Error('Counter-integrity library requires a counter-integrity turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Counter-integrity library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Counter-integrity library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['invalidCount', 'invalid count'],
    ['incompleteCount', 'incomplete count'],
    ['noGpuCount', 'no-GPU count'],
    ['inconsistentCount', 'inconsistent count'],
    ['consistentCount', 'consistent count']
  ]) requireCount(report, field, label);
  if (!bounded(report.maximumErrorPercent, 0, 100)) {
    throw new RangeError('Counter-integrity library maximumErrorPercent must be between 0 and 100');
  }
  if (!bounded(report.tolerancePercent, 0, 100)) {
    throw new RangeError('Counter-integrity library tolerancePercent must be between 0 and 100');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Counter-integrity library persistenceThreshold must be from 1 to 64');
  }
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Counter-integrity library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Counter-integrity library reports must be an array');
  if (reports.length > 64) throw new RangeError('Counter-integrity library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-vram-evidence')) return 'invalid-vram-evidence';
  if (reports.some((report) => report.state === 'incomplete-vram-evidence')) {
    return 'incomplete-vram-evidence';
  }
  if (reports.some((report) => report.state === 'inconsistent-counters-sustained')) {
    return 'inconsistent-counters-sustained';
  }
  if (reports.some((report) => report.state === 'inconsistent-counters-observed')) {
    return 'inconsistent-counters-observed';
  }
  if (reports.every((report) => report.state === 'no-gpu')) return 'no-gpu';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'consistent-counters')
    ? 'consistent-counters' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'inconsistent-counters-sustained') {
    return Object.freeze(['review-vram-counter-source', 'hold-unapproved-memory-policy']);
  }
  if (state === 'inconsistent-counters-observed') return Object.freeze(['observe-next-vram-counter-sample']);
  if (state === 'invalid-vram-evidence') return Object.freeze(['review-vram-counter-range']);
  if (state === 'incomplete-vram-evidence') return Object.freeze(['request-complete-vram-counters']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-memory-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-vram-counter-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-vram-counter-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'inconsistent-counters-sustained') return 'counter-source-review';
  if (state === 'inconsistent-counters-observed') return 'counter-observation';
  if (state === 'invalid-vram-evidence') return 'counter-range-review';
  if (state === 'incomplete-vram-evidence') return 'evidence-bootstrap';
  if (state === 'no-gpu') return 'no-gpu-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'consistent-counter-observation';
}

function intervalFor(state, environment) {
  if (state === 'inconsistent-counters-sustained') return 750;
  if (state === 'inconsistent-counters-observed') return 1000;
  if (state === 'invalid-vram-evidence') return 500;
  if (state === 'incomplete-vram-evidence') return 1500;
  if (state === 'no-gpu') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeGpuCounterIntegrityReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: GPU_COUNTER_INTEGRITY_LIBRARY_ID,
    libraryVersion: GPU_COUNTER_INTEGRITY_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noGpuCount: validated.reduce((sum, report) => sum + report.noGpuCount, 0),
    inconsistentCount: validated.reduce((sum, report) => sum + report.inconsistentCount, 0),
    consistentCount: validated.reduce((sum, report) => sum + report.consistentCount, 0),
    maximumErrorPercent: validated.length === 0 ? 0
      : Math.max(...validated.map((report) => report.maximumErrorPercent)),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildGpuCounterIntegrityPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: GPU_COUNTER_INTEGRITY_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0
      ? 0 : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Counter-integrity library clock must return a number');
  return timestamp;
}

export function buildGpuCounterIntegrityEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Counter-integrity library trigger is required');
  }
  return Object.freeze({
    library: GPU_COUNTER_INTEGRITY_LIBRARY_ID,
    libraryVersion: GPU_COUNTER_INTEGRITY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createGpuCounterIntegrityLibrary() {
  return Object.freeze({
    id: GPU_COUNTER_INTEGRITY_LIBRARY_ID,
    version: GPU_COUNTER_INTEGRITY_LIBRARY_VERSION,
    merge: mergeGpuCounterIntegrityReports,
    plan: buildGpuCounterIntegrityPlan,
    envelope: buildGpuCounterIntegrityEnvelope
  });
}
