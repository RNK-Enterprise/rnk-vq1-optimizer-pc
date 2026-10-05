/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated VRAM-pressure library. It validates, aggregates, and plans VRAM
 * reports without importing the turbo or changing GPU policy.
 */

export const GPU_VRAM_PRESSURE_LIBRARY_ID = 'gpu-utilization.vram-pressure.library';
export const GPU_VRAM_PRESSURE_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'sustained-critical-vram',
  'sustained-elevated-vram',
  'normal-vram-pressure',
  'no-vram',
  'invalid-vram-evidence',
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
    throw new RangeError(`VRAM-pressure library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('VRAM-pressure library report must be an object');
  if (report.turbo !== 'gpu-utilization.vram-pressure') {
    throw new Error('VRAM-pressure library requires a vram-pressure turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('VRAM-pressure library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('VRAM-pressure library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['noVramCount', 'no-VRAM count'],
    ['criticalCount', 'critical count'],
    ['elevatedCount', 'elevated count']
  ]) requireCount(report, field, label);
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('VRAM-pressure library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('VRAM-pressure library reports must be an array');
  if (reports.length > 64) throw new RangeError('VRAM-pressure library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-vram-evidence')) return 'invalid-vram-evidence';
  if (reports.some((report) => report.state === 'sustained-critical-vram')) return 'sustained-critical-vram';
  if (reports.some((report) => report.state === 'sustained-elevated-vram')) return 'sustained-elevated-vram';
  if (reports.every((report) => report.state === 'no-vram')) return 'no-vram';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'normal-vram-pressure')
    ? 'normal-vram-pressure' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'invalid-vram-evidence') return Object.freeze(['review-gpu-vram-sensor-range']);
  if (state === 'sustained-critical-vram') return Object.freeze(['hold-unapproved-gpu-policy', 'protect-vram-headroom']);
  if (state === 'sustained-elevated-vram') return Object.freeze(['observe-next-vram-sample', 'review-vram-headroom']);
  if (state === 'no-vram') return Object.freeze(['no-change', 'keep-vram-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-gpu-vram-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-gpu-vram-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-vram-evidence') return 'sensor-review';
  if (state === 'sustained-critical-vram') return 'vram-protection';
  if (state === 'sustained-elevated-vram') return 'vram-observation';
  if (state === 'no-vram') return 'no-vram-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'normal-vram-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-vram-evidence') return 500;
  if (state === 'sustained-critical-vram') return 750;
  if (state === 'sustained-elevated-vram') return 1000;
  if (state === 'no-vram') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeGpuVramPressureReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: GPU_VRAM_PRESSURE_LIBRARY_ID,
    libraryVersion: GPU_VRAM_PRESSURE_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    noVramCount: validated.reduce((sum, report) => sum + report.noVramCount, 0),
    criticalCount: validated.reduce((sum, report) => sum + report.criticalCount, 0),
    elevatedCount: validated.reduce((sum, report) => sum + report.elevatedCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildGpuVramPressurePlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: GPU_VRAM_PRESSURE_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('VRAM-pressure library clock must return a number');
  return timestamp;
}

export function buildGpuVramPressureEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('VRAM-pressure library trigger is required');
  }
  return Object.freeze({
    library: GPU_VRAM_PRESSURE_LIBRARY_ID,
    libraryVersion: GPU_VRAM_PRESSURE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createGpuVramPressureLibrary() {
  return Object.freeze({
    id: GPU_VRAM_PRESSURE_LIBRARY_ID,
    version: GPU_VRAM_PRESSURE_LIBRARY_VERSION,
    merge: mergeGpuVramPressureReports,
    plan: buildGpuVramPressurePlan,
    envelope: buildGpuVramPressureEnvelope
  });
}
