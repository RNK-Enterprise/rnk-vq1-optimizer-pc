/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated target-gap library. It validates, aggregates, and plans FPS
 * shortfall reports without importing the turbo or changing display policy.
 */

export const FRAME_TARGET_GAP_LIBRARY_ID = 'frame-pacing.target-gap.library';
export const FRAME_TARGET_GAP_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'critical-gap-sustained', 'critical-gap-observed', 'elevated-gap-sustained',
  'elevated-gap-observed', 'healthy-target-gap', 'no-display', 'no-observation',
  'incomplete-target-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Target-gap library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireMetric(value, label) {
  if (value !== null && !nonNegative(value)) {
    throw new RangeError(`Target-gap library ${label} must be null or non-negative`);
  }
  return value;
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Target-gap library report must be an object');
  if (report.turbo !== 'frame-pacing.target-gap') {
    throw new Error('Target-gap library requires a target-gap turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Target-gap library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Target-gap library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Target-gap library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Target-gap library persistenceThreshold must be from 1 to 64');
  }
  if (!nonNegative(report.criticalThreshold) || !nonNegative(report.elevatedThreshold)) {
    throw new RangeError('Target-gap library thresholds must be non-negative');
  }
  if (report.elevatedThreshold >= report.criticalThreshold) {
    throw new RangeError('Target-gap library elevatedThreshold must be below criticalThreshold');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noDisplayCount', 'no-display count'], ['noObservationCount', 'no-observation count'],
    ['criticalCount', 'critical count'], ['elevatedCount', 'elevated count']
  ]) requireCount(report, field, label);
  requireMetric(report.maximumGap, 'maximumGap');
  if (!nonNegative(report.confidence) || report.confidence > 1) {
    throw new RangeError('Target-gap library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Target-gap library reports must be an array');
  if (reports.length > 64) throw new RangeError('Target-gap library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-display')) return 'no-display';
  if (reports.some((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.some((report) => report.state === 'incomplete-target-evidence')) {
    return 'incomplete-target-evidence';
  }
  if (reports.some((report) => report.state === 'critical-gap-sustained')) {
    return 'critical-gap-sustained';
  }
  if (reports.some((report) => report.state === 'critical-gap-observed')) {
    return 'critical-gap-observed';
  }
  if (reports.some((report) => report.state === 'elevated-gap-sustained')) {
    return 'elevated-gap-sustained';
  }
  if (reports.some((report) => report.state === 'elevated-gap-observed')) {
    return 'elevated-gap-observed';
  }
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'healthy-target-gap';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-target-gap-samples']);
  if (state === 'no-display') return Object.freeze(['keep-display-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-target-gap-observation']);
  if (state === 'incomplete-target-evidence') return Object.freeze(['request-explicit-fps-target']);
  if (state === 'critical-gap-sustained') {
    return Object.freeze(['review-foreground-workload', 'hold-unapproved-display-policy']);
  }
  if (state === 'critical-gap-observed') return Object.freeze(['observe-next-target-gap-sample']);
  if (state === 'elevated-gap-sustained') return Object.freeze(['review-fps-target-gap']);
  if (state === 'elevated-gap-observed') return Object.freeze(['observe-next-target-gap-sample']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'critical-gap-sustained') return 'critical-gap-review';
  if (state === 'critical-gap-observed') return 'critical-gap-observation';
  if (state === 'elevated-gap-sustained') return 'elevated-gap-review';
  if (state === 'elevated-gap-observed') return 'elevated-gap-observation';
  if (state === 'no-display') return 'no-display-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'incomplete-target-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'healthy-target-observation';
}

function intervalFor(state, environment) {
  if (state === 'critical-gap-sustained') return 750;
  if (state === 'critical-gap-observed') return 1000;
  if (state === 'elevated-gap-sustained') return 1000;
  if (state === 'elevated-gap-observed') return 1500;
  if (state === 'no-display') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'incomplete-target-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function maximumGap(reports) {
  const values = reports.map((report) => report.maximumGap).filter((value) => value !== null);
  return values.length === 0 ? null : Math.max(...values);
}

export function mergeFrameTargetGapReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: FRAME_TARGET_GAP_LIBRARY_ID,
    libraryVersion: FRAME_TARGET_GAP_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDisplayCount: validated.reduce((sum, report) => sum + report.noDisplayCount, 0),
    noObservationCount: validated.reduce((sum, report) => sum + report.noObservationCount, 0),
    criticalCount: validated.reduce((sum, report) => sum + report.criticalCount, 0),
    elevatedCount: validated.reduce((sum, report) => sum + report.elevatedCount, 0),
    maximumGap: maximumGap(validated),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildFrameTargetGapPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: FRAME_TARGET_GAP_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0 ? 0
      : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Target-gap library clock must return a number');
  return timestamp;
}

export function buildFrameTargetGapEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Target-gap library trigger is required');
  return Object.freeze({
    library: FRAME_TARGET_GAP_LIBRARY_ID,
    libraryVersion: FRAME_TARGET_GAP_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createFrameTargetGapLibrary() {
  return Object.freeze({
    id: FRAME_TARGET_GAP_LIBRARY_ID,
    version: FRAME_TARGET_GAP_LIBRARY_VERSION,
    merge: mergeFrameTargetGapReports,
    plan: buildFrameTargetGapPlan,
    envelope: buildFrameTargetGapEnvelope
  });
}
