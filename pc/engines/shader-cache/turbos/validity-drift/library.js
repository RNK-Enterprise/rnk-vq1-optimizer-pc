/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated validity-drift library. It validates cache validity evidence and
 * builds review plans without deleting or rebuilding cache files.
 */
export const SHADER_VALIDITY_DRIFT_LIBRARY_ID = 'shader-cache.validity-drift.library';
export const SHADER_VALIDITY_DRIFT_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-validity', 'stale-review', 'validity-drift-observed', 'validity-drift-sustained', 'observation-required', 'no-caches', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Validity-drift library report must be an object');
  if (report.turbo !== 'shader-cache.validity-drift') throw new Error('Validity-drift library requires a validity-drift turbo report');
  if (!STATES.includes(report.state)) throw new Error('Validity-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Validity-drift library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Validity-drift library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Validity-drift library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['cacheCount', 'cache count'], ['validCount', 'valid count'], ['staleCount', 'stale count'], ['unknownCount', 'unknown count'], ['comparisonCount', 'comparison count'], ['changeCount', 'change count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Validity-drift library ${label} must be from 0 to 4096`);
  }
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Validity-drift library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Validity-drift library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Validity-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Validity-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'validity-drift-sustained')) return 'validity-drift-sustained';
  if (reports.some((report) => report.state === 'validity-drift-observed')) return 'validity-drift-observed';
  if (reports.some((report) => report.state === 'stale-review')) return 'stale-review';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  if (reports.every((report) => report.state === 'no-caches')) return 'no-caches';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-validity';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cache-validity-samples']);
  if (state === 'no-caches') return Object.freeze(['no-shader-cache-review']);
  if (state === 'observation-required') return Object.freeze(['request-shader-cache-validity-observation']);
  if (state === 'validity-drift-sustained') return Object.freeze(['review-validity-drift-without-cache-mutation']);
  if (state === 'validity-drift-observed') return Object.freeze(['observe-shader-cache-validity']);
  if (state === 'stale-review') return Object.freeze(['review-driver-documented-rebuild-path']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'no-caches') return 'empty-observation';
  if (state === 'validity-drift-sustained') return 'validity-review';
  if (state === 'validity-drift-observed') return 'validity-observation';
  if (state === 'stale-review') return 'stale-review';
  if (state === 'observation-required' || state === 'insufficient-data') return 'evidence-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'no-caches') return 10000;
  if (state === 'validity-drift-sustained') return 1000;
  if (state === 'validity-drift-observed' || state === 'stale-review') return 1500;
  if (state === 'observation-required' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeShaderValidityDriftReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: SHADER_VALIDITY_DRIFT_LIBRARY_ID, libraryVersion: SHADER_VALIDITY_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    cacheCount: latest?.cacheCount || 0, validCount: latest?.validCount || 0, staleCount: latest?.staleCount || 0,
    unknownCount: latest?.unknownCount || 0, comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0), finalEnvironment: latest?.finalEnvironment || 'unknown',
    confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildShaderValidityDriftPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: SHADER_VALIDITY_DRIFT_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Validity-drift library clock must return a number'); return timestamp; }
export function buildShaderValidityDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Validity-drift library trigger is required');
  return Object.freeze({ library: SHADER_VALIDITY_DRIFT_LIBRARY_ID, libraryVersion: SHADER_VALIDITY_DRIFT_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createShaderValidityDriftLibrary() {
  return Object.freeze({ id: SHADER_VALIDITY_DRIFT_LIBRARY_ID, version: SHADER_VALIDITY_DRIFT_LIBRARY_VERSION,
    merge: mergeShaderValidityDriftReports, plan: buildShaderValidityDriftPlan, envelope: buildShaderValidityDriftEnvelope });
}
