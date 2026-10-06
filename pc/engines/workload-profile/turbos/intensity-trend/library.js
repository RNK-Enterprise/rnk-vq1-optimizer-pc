/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated workload-profile intensity-trend library. It validates intensity
 * reports and builds review plans without changing workload controls.
 */

export const WORKLOAD_INTENSITY_TREND_LIBRARY_ID = 'workload-profile.intensity-trend.library';
export const WORKLOAD_INTENSITY_TREND_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-intensity', 'high-intensity', 'low-intensity', 'intensity-rise-observed', 'intensity-fall-observed', 'intensity-rise-sustained', 'intensity-fall-sustained', 'observation-required', 'intensity-unknown', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Intensity-trend library report must be an object');
  if (report.turbo !== 'workload-profile.intensity-trend') throw new Error('Intensity-trend library requires an intensity-trend turbo report');
  if (!STATES.includes(report.state)) throw new Error('Intensity-trend library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Intensity-trend library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Intensity-trend library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Intensity-trend library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['observedCount', 'observed count'], ['unknownCount', 'unknown count'], ['comparisonCount', 'comparison count'], ['changedCount', 'changed count'], ['risingCount', 'rising count'], ['fallingCount', 'falling count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Intensity-trend library ${label} must be from 0 to 4096`);
  }
  if (report.finalIntensity !== null && (!Number.isFinite(report.finalIntensity) || report.finalIntensity < 0 || report.finalIntensity > 100)) throw new TypeError('Intensity-trend library finalIntensity must be from 0 to 100 or null');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Intensity-trend library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Intensity-trend library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Intensity-trend library reports must be an array');
  if (reports.length > 64) throw new RangeError('Intensity-trend library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  if (reports.some((report) => report.state === 'intensity-unknown')) return 'intensity-unknown';
  if (reports.some((report) => report.state === 'intensity-rise-sustained')) return 'intensity-rise-sustained';
  if (reports.some((report) => report.state === 'intensity-fall-sustained')) return 'intensity-fall-sustained';
  if (reports.some((report) => report.state === 'intensity-rise-observed')) return 'intensity-rise-observed';
  if (reports.some((report) => report.state === 'intensity-fall-observed')) return 'intensity-fall-observed';
  if (reports.some((report) => report.state === 'high-intensity')) return 'high-intensity';
  if (reports.some((report) => report.state === 'low-intensity')) return 'low-intensity';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-intensity';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-workload-intensity']);
  if (state === 'intensity-unknown') return Object.freeze(['request-workload-intensity-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-workload-intensity']);
  if (state === 'intensity-rise-sustained') return Object.freeze(['review-sustained-workload-intensity-rise']);
  if (state === 'intensity-fall-sustained') return Object.freeze(['review-sustained-workload-intensity-fall']);
  if (state === 'intensity-rise-observed') return Object.freeze(['observe-workload-intensity-rise']);
  if (state === 'intensity-fall-observed') return Object.freeze(['observe-workload-intensity-fall']);
  if (state === 'high-intensity') return Object.freeze(['review-high-workload-intensity']);
  if (state === 'low-intensity') return Object.freeze(['preserve-low-workload-intensity']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'observation-required' || state === 'intensity-unknown') return 'evidence-bootstrap';
  if (state === 'intensity-rise-sustained' || state === 'intensity-fall-sustained') return 'intensity-review';
  if (state === 'intensity-rise-observed' || state === 'intensity-fall-observed') return 'intensity-observation';
  if (state === 'high-intensity' || state === 'low-intensity') return 'intensity-boundary-review';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'observation-required' || state === 'intensity-unknown' || state === 'insufficient-data') return 2000;
  if (state === 'intensity-rise-sustained' || state === 'intensity-fall-sustained') return 750;
  if (state === 'intensity-rise-observed' || state === 'intensity-fall-observed') return 1500;
  if (state === 'high-intensity' || state === 'low-intensity') return 2500;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeWorkloadIntensityTrendReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: WORKLOAD_INTENSITY_TREND_LIBRARY_ID, libraryVersion: WORKLOAD_INTENSITY_TREND_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), changedCount: validated.reduce((sum, report) => sum + report.changedCount, 0),
    risingCount: validated.reduce((sum, report) => sum + report.risingCount, 0), fallingCount: validated.reduce((sum, report) => sum + report.fallingCount, 0),
    finalIntensity: latest?.finalIntensity ?? null, finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0,
    recommendations: recommendations(state) });
}
export function buildWorkloadIntensityTrendPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: WORKLOAD_INTENSITY_TREND_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment), state: validated.state,
    confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Intensity-trend library clock must return a number'); return timestamp; }
export function buildWorkloadIntensityTrendEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Intensity-trend library trigger is required');
  return Object.freeze({ library: WORKLOAD_INTENSITY_TREND_LIBRARY_ID, libraryVersion: WORKLOAD_INTENSITY_TREND_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createWorkloadIntensityTrendLibrary() {
  return Object.freeze({ id: WORKLOAD_INTENSITY_TREND_LIBRARY_ID, version: WORKLOAD_INTENSITY_TREND_LIBRARY_VERSION,
    merge: mergeWorkloadIntensityTrendReports, plan: buildWorkloadIntensityTrendPlan, envelope: buildWorkloadIntensityTrendEnvelope });
}
