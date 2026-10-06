/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated allocation-headroom library. It validates, aggregates, and plans
 * VRAM headroom reports without importing the turbo or changing memory policy.
 */

export const GPU_ALLOCATION_HEADROOM_LIBRARY_ID = 'gpu-memory.allocation-headroom.library';
export const GPU_ALLOCATION_HEADROOM_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'critical-headroom-sustained',
  'critical-headroom-observed',
  'low-headroom-sustained',
  'low-headroom-observed',
  'healthy-headroom',
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
    throw new RangeError(`Allocation-headroom library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Allocation-headroom library report must be an object');
  if (report.turbo !== 'gpu-memory.allocation-headroom') {
    throw new Error('Allocation-headroom library requires an allocation-headroom turbo report');
  }
  if (!STATES.includes(report.state)) {
    throw new Error('Allocation-headroom library report has an invalid state');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Allocation-headroom library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['invalidCount', 'invalid count'],
    ['incompleteCount', 'incomplete count'],
    ['noGpuCount', 'no-GPU count'],
    ['criticalCount', 'critical count'],
    ['lowCount', 'low count']
  ]) requireCount(report, field, label);
  if (!bounded(report.minimumHeadroom, 0, 100)) {
    throw new RangeError('Allocation-headroom library minimumHeadroom must be between 0 and 100');
  }
  if (!bounded(report.criticalThreshold, 0, 100)
    || !bounded(report.lowThreshold, 0, 100)) {
    throw new RangeError('Allocation-headroom library thresholds must be between 0 and 100');
  }
  if (report.lowThreshold <= report.criticalThreshold) {
    throw new RangeError('Allocation-headroom library lowThreshold must exceed criticalThreshold');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Allocation-headroom library persistenceThreshold must be from 1 to 64');
  }
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Allocation-headroom library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Allocation-headroom library reports must be an array');
  if (reports.length > 64) throw new RangeError('Allocation-headroom library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-vram-evidence')) return 'invalid-vram-evidence';
  if (reports.some((report) => report.state === 'incomplete-vram-evidence')) {
    return 'incomplete-vram-evidence';
  }
  if (reports.some((report) => report.state === 'critical-headroom-sustained')) {
    return 'critical-headroom-sustained';
  }
  if (reports.some((report) => report.state === 'critical-headroom-observed')) {
    return 'critical-headroom-observed';
  }
  if (reports.some((report) => report.state === 'low-headroom-sustained')) {
    return 'low-headroom-sustained';
  }
  if (reports.some((report) => report.state === 'low-headroom-observed')) {
    return 'low-headroom-observed';
  }
  if (reports.every((report) => report.state === 'no-gpu')) return 'no-gpu';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'healthy-headroom')
    ? 'healthy-headroom' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'critical-headroom-sustained') {
    return Object.freeze(['protect-vram-headroom', 'hold-unapproved-memory-policy']);
  }
  if (state === 'critical-headroom-observed') return Object.freeze(['observe-next-vram-headroom-sample']);
  if (state === 'low-headroom-sustained') {
    return Object.freeze(['review-vram-allocation-pressure', 'hold-unapproved-memory-policy']);
  }
  if (state === 'low-headroom-observed') return Object.freeze(['observe-next-vram-headroom-sample']);
  if (state === 'invalid-vram-evidence') return Object.freeze(['review-vram-counter-range']);
  if (state === 'incomplete-vram-evidence') return Object.freeze(['request-complete-vram-evidence']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-memory-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-vram-headroom-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-vram-headroom-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'critical-headroom-sustained') return 'headroom-protection-review';
  if (state === 'critical-headroom-observed') return 'critical-headroom-observation';
  if (state === 'low-headroom-sustained') return 'allocation-pressure-review';
  if (state === 'low-headroom-observed') return 'low-headroom-observation';
  if (state === 'invalid-vram-evidence') return 'counter-review';
  if (state === 'incomplete-vram-evidence') return 'evidence-bootstrap';
  if (state === 'no-gpu') return 'no-gpu-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'healthy-headroom-observation';
}

function intervalFor(state, environment) {
  if (state === 'critical-headroom-sustained') return 750;
  if (state === 'critical-headroom-observed') return 1000;
  if (state === 'low-headroom-sustained') return 1000;
  if (state === 'low-headroom-observed') return 1250;
  if (state === 'invalid-vram-evidence') return 500;
  if (state === 'incomplete-vram-evidence') return 1500;
  if (state === 'no-gpu') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeGpuAllocationHeadroomReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: GPU_ALLOCATION_HEADROOM_LIBRARY_ID,
    libraryVersion: GPU_ALLOCATION_HEADROOM_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noGpuCount: validated.reduce((sum, report) => sum + report.noGpuCount, 0),
    criticalCount: validated.reduce((sum, report) => sum + report.criticalCount, 0),
    lowCount: validated.reduce((sum, report) => sum + report.lowCount, 0),
    minimumHeadroom: validated.length === 0 ? 100
      : Math.min(...validated.map((report) => report.minimumHeadroom)),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildGpuAllocationHeadroomPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: GPU_ALLOCATION_HEADROOM_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Allocation-headroom library clock must return a number');
  return timestamp;
}

export function buildGpuAllocationHeadroomEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Allocation-headroom library trigger is required');
  }
  return Object.freeze({
    library: GPU_ALLOCATION_HEADROOM_LIBRARY_ID,
    libraryVersion: GPU_ALLOCATION_HEADROOM_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createGpuAllocationHeadroomLibrary() {
  return Object.freeze({
    id: GPU_ALLOCATION_HEADROOM_LIBRARY_ID,
    version: GPU_ALLOCATION_HEADROOM_LIBRARY_VERSION,
    merge: mergeGpuAllocationHeadroomReports,
    plan: buildGpuAllocationHeadroomPlan,
    envelope: buildGpuAllocationHeadroomEnvelope
  });
}
