/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated drop-budget library. It validates, aggregates, and plans dropped
 * frame reports without importing the turbo or changing display policy.
 */

export const FRAME_DROP_BUDGET_LIBRARY_ID = 'frame-pacing.drop-budget.library';
export const FRAME_DROP_BUDGET_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'critical-drop-sustained', 'critical-drop-observed', 'elevated-drop-sustained',
  'elevated-drop-observed', 'normal-drop-budget', 'no-display', 'no-observation',
  'incomplete-drop-evidence', 'insufficient-data'
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
    throw new RangeError(`Drop-budget library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireMetric(value, label) {
  if (value !== null && !bounded(value, 0, 100)) {
    throw new RangeError(`Drop-budget library ${label} must be null or between 0 and 100`);
  }
  return value;
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Drop-budget library report must be an object');
  if (report.turbo !== 'frame-pacing.drop-budget') {
    throw new Error('Drop-budget library requires a drop-budget turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Drop-budget library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Drop-budget library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Drop-budget library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Drop-budget library persistenceThreshold must be from 1 to 64');
  }
  if (!bounded(report.criticalThreshold, 0, 100)
    || !bounded(report.elevatedThreshold, 0, 100)) {
    throw new RangeError('Drop-budget library thresholds must be between 0 and 100');
  }
  if (report.elevatedThreshold >= report.criticalThreshold) {
    throw new RangeError('Drop-budget library elevatedThreshold must be below criticalThreshold');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noDisplayCount', 'no-display count'], ['noObservationCount', 'no-observation count'],
    ['criticalCount', 'critical count'], ['elevatedCount', 'elevated count']
  ]) requireCount(report, field, label);
  requireMetric(report.maximumDroppedPercent, 'maximumDroppedPercent');
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Drop-budget library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Drop-budget library reports must be an array');
  if (reports.length > 64) throw new RangeError('Drop-budget library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-display')) return 'no-display';
  if (reports.some((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.some((report) => report.state === 'incomplete-drop-evidence')) {
    return 'incomplete-drop-evidence';
  }
  if (reports.some((report) => report.state === 'critical-drop-sustained')) {
    return 'critical-drop-sustained';
  }
  if (reports.some((report) => report.state === 'critical-drop-observed')) {
    return 'critical-drop-observed';
  }
  if (reports.some((report) => report.state === 'elevated-drop-sustained')) {
    return 'elevated-drop-sustained';
  }
  if (reports.some((report) => report.state === 'elevated-drop-observed')) {
    return 'elevated-drop-observed';
  }
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'normal-drop-budget';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-dropped-frame-samples']);
  if (state === 'no-display') return Object.freeze(['keep-display-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-dropped-frame-observation']);
  if (state === 'incomplete-drop-evidence') return Object.freeze(['request-complete-drop-evidence']);
  if (state === 'critical-drop-sustained') {
    return Object.freeze(['protect-foreground', 'hold-unapproved-display-policy']);
  }
  if (state === 'critical-drop-observed') return Object.freeze(['observe-next-drop-sample']);
  if (state === 'elevated-drop-sustained') return Object.freeze(['review-frame-drop-budget']);
  if (state === 'elevated-drop-observed') return Object.freeze(['observe-next-drop-sample']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'critical-drop-sustained') return 'critical-drop-review';
  if (state === 'critical-drop-observed') return 'critical-drop-observation';
  if (state === 'elevated-drop-sustained') return 'elevated-drop-review';
  if (state === 'elevated-drop-observed') return 'elevated-drop-observation';
  if (state === 'no-display') return 'no-display-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'incomplete-drop-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'normal-drop-observation';
}

function intervalFor(state, environment) {
  if (state === 'critical-drop-sustained') return 750;
  if (state === 'critical-drop-observed') return 1000;
  if (state === 'elevated-drop-sustained') return 1000;
  if (state === 'elevated-drop-observed') return 1500;
  if (state === 'no-display') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'incomplete-drop-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function maximumDroppedPercent(reports) {
  const values = reports.map((report) => report.maximumDroppedPercent)
    .filter((value) => value !== null);
  return values.length === 0 ? null : Math.max(...values);
}

export function mergeFrameDropBudgetReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: FRAME_DROP_BUDGET_LIBRARY_ID,
    libraryVersion: FRAME_DROP_BUDGET_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDisplayCount: validated.reduce((sum, report) => sum + report.noDisplayCount, 0),
    noObservationCount: validated.reduce((sum, report) => sum + report.noObservationCount, 0),
    criticalCount: validated.reduce((sum, report) => sum + report.criticalCount, 0),
    elevatedCount: validated.reduce((sum, report) => sum + report.elevatedCount, 0),
    maximumDroppedPercent: maximumDroppedPercent(validated),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildFrameDropBudgetPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: FRAME_DROP_BUDGET_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Drop-budget library clock must return a number');
  return timestamp;
}

export function buildFrameDropBudgetEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Drop-budget library trigger is required');
  return Object.freeze({
    library: FRAME_DROP_BUDGET_LIBRARY_ID,
    libraryVersion: FRAME_DROP_BUDGET_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createFrameDropBudgetLibrary() {
  return Object.freeze({
    id: FRAME_DROP_BUDGET_LIBRARY_ID,
    version: FRAME_DROP_BUDGET_LIBRARY_VERSION,
    merge: mergeFrameDropBudgetReports,
    plan: buildFrameDropBudgetPlan,
    envelope: buildFrameDropBudgetEnvelope
  });
}
