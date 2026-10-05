/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated stability-turbo library. It aggregates bounded stability reports
 * and builds an observation plan without importing the turbo or executing any
 * operating-system action.
 */

export const SYSTEM_FACTS_STABILITY_LIBRARY_ID = 'system-facts.stability.library';
export const SYSTEM_FACTS_STABILITY_LIBRARY_VERSION = 1;

const STATES = Object.freeze(['stable', 'watch', 'unstable', 'insufficient-data']);
const TRENDS = Object.freeze(['flat', 'rising', 'falling']);
const ENVIRONMENT_POLICY = Object.freeze({
  interactive: Object.freeze({ window: 8, stableRecheckMs: 60000 }),
  headless: Object.freeze({ window: 16, stableRecheckMs: 120000 }),
  unknown: Object.freeze({ window: 4, stableRecheckMs: 30000 })
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}

function rounded(value) {
  return Math.round(value * 10000) / 10000;
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Stability library report must be an object');
  if (report.turbo !== 'system-facts.stability') {
    throw new Error('Stability library requires a stability turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Stability library report has an invalid state');
  if (!TRENDS.includes(report.trend)) throw new Error('Stability library report has an invalid trend');
  if (report.score !== null && (!Number.isFinite(report.score) || report.score < 0 || report.score > 100)) {
    throw new RangeError('Stability library report score must be null or between 0 and 100');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Stability library report sampleCount must be a non-negative integer');
  }
  if (report.volatility !== null && (!Number.isFinite(report.volatility) || report.volatility < 0)) {
    throw new RangeError('Stability library report volatility must be null or non-negative');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Stability library reports must be an array');
  if (reports.length > 64) throw new RangeError('Stability library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function reportWeight(report) {
  return Math.max(1, report.sampleCount);
}

function weightedScore(reports) {
  const usable = reports.filter((report) => report.score !== null);
  if (usable.length === 0) return null;
  const totalWeight = usable.reduce((sum, report) => sum + reportWeight(report), 0);
  const total = usable.reduce((sum, report) => sum + (report.score * reportWeight(report)), 0);
  return rounded(total / totalWeight);
}

function mode(values, order) {
  const counts = Object.fromEntries(order.map((item) => [item, 0]));
  values.forEach((value) => { counts[value] += 1; });
  return order.reduce((winner, item) => counts[item] > counts[winner] ? item : winner, order[0]);
}

function mergedVolatility(reports) {
  const values = reports
    .filter((report) => report.volatility !== null)
    .map((report) => report.volatility);
  return values.length === 0 ? null : rounded(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const usable = reports.filter((report) => report.score !== null).length;
  return rounded(clamp(usable / reports.length, 0, 1));
}

export function mergeStabilityReports(reports) {
  const validated = requireReports(reports);
  return Object.freeze({
    library: SYSTEM_FACTS_STABILITY_LIBRARY_ID,
    reportCount: validated.length,
    score: weightedScore(validated),
    state: validated.length === 0 ? 'insufficient-data' : mode(validated.map((report) => report.state), STATES),
    trend: validated.length === 0 ? 'flat' : mode(validated.map((report) => report.trend), TRENDS),
    volatility: mergedVolatility(validated),
    confidence: mergedConfidence(validated),
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0)
  });
}

function environmentPolicy(environment) {
  return ENVIRONMENT_POLICY[environment] || ENVIRONMENT_POLICY.unknown;
}

function windowSizeFor(report, environment) {
  const policy = environmentPolicy(environment);
  if (report.state === 'unstable') return Math.min(64, policy.window * 2);
  if (report.state === 'watch') return policy.window;
  if (report.state === 'stable' && report.volatility !== null && report.volatility <= 0.1) {
    return Math.min(64, policy.window * 2);
  }
  if (report.state === 'stable') return policy.window;
  return 4;
}

function recheckIntervalFor(report, environment) {
  const policy = environmentPolicy(environment);
  if (report.state === 'unstable') return 5000;
  if (report.state === 'watch') return 15000;
  if (report.state === 'stable') return policy.stableRecheckMs;
  return 10000;
}

function planMode(report, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (report.state === 'unstable') return 'accelerated-observation';
  if (report.state === 'insufficient-data') return 'bootstrap-observation';
  if (report.state === 'stable') return 'relaxed-observation';
  return 'watch-observation';
}

export function buildStabilityPlan(report, environment) {
  const validated = requireReport(report);
  const policy = environmentPolicy(environment);
  return Object.freeze({
    library: SYSTEM_FACTS_STABILITY_LIBRARY_ID,
    environment: environment || 'unknown',
    mode: planMode(validated, environment),
    windowSize: windowSizeFor(validated, environment),
    recheckMs: recheckIntervalFor(validated, environment),
    stableRecheckMs: policy.stableRecheckMs,
    score: validated.score,
    state: validated.state,
    trend: validated.trend
  });
}

export function createStabilityLibrary() {
  return Object.freeze({
    id: SYSTEM_FACTS_STABILITY_LIBRARY_ID,
    version: SYSTEM_FACTS_STABILITY_LIBRARY_VERSION,
    merge: mergeStabilityReports,
    plan: buildStabilityPlan
  });
}
