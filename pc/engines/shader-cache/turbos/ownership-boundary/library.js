/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated ownership-boundary library. It validates ownership evidence and
 * builds review plans without deleting, rebuilding, or moving cache files.
 */
export const SHADER_OWNERSHIP_BOUNDARY_LIBRARY_ID = 'shader-cache.ownership-boundary.library';
export const SHADER_OWNERSHIP_BOUNDARY_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-ownership', 'ownership-drift-observed', 'ownership-drift-sustained', 'user-owned-review', 'ownership-required', 'no-caches', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Ownership-boundary library report must be an object');
  if (report.turbo !== 'shader-cache.ownership-boundary') throw new Error('Ownership-boundary library requires an ownership-boundary turbo report');
  if (!STATES.includes(report.state)) throw new Error('Ownership-boundary library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Ownership-boundary library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Ownership-boundary library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Ownership-boundary library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['cacheCount', 'cache count'], ['systemOwnedCount', 'system-owned count'], ['userOwnedCount', 'user-owned count'], ['unknownOwnershipCount', 'unknown-ownership count'], ['comparisonCount', 'comparison count'], ['changeCount', 'change count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Ownership-boundary library ${label} must be from 0 to 4096`);
  }
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Ownership-boundary library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Ownership-boundary library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Ownership-boundary library reports must be an array');
  if (reports.length > 64) throw new RangeError('Ownership-boundary library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'user-owned-review')) return 'user-owned-review';
  if (reports.some((report) => report.state === 'ownership-required')) return 'ownership-required';
  if (reports.some((report) => report.state === 'ownership-drift-sustained')) return 'ownership-drift-sustained';
  if (reports.some((report) => report.state === 'ownership-drift-observed')) return 'ownership-drift-observed';
  if (reports.every((report) => report.state === 'no-caches')) return 'no-caches';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-ownership';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cache-ownership-samples']);
  if (state === 'no-caches') return Object.freeze(['no-shader-cache-review']);
  if (state === 'user-owned-review') return Object.freeze(['preserve-user-owned-cache-boundary']);
  if (state === 'ownership-required') return Object.freeze(['request-shader-cache-ownership']);
  if (state === 'ownership-drift-sustained') return Object.freeze(['review-cache-ownership-drift-without-mutation']);
  if (state === 'ownership-drift-observed') return Object.freeze(['observe-cache-ownership-stability']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'no-caches') return 'empty-observation';
  if (state === 'user-owned-review') return 'user-boundary';
  if (state === 'ownership-required') return 'ownership-bootstrap';
  if (state === 'ownership-drift-sustained') return 'ownership-review';
  if (state === 'ownership-drift-observed') return 'ownership-observation';
  if (state === 'insufficient-data') return 'evidence-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'user-owned-review') return 750;
  if (state === 'ownership-drift-sustained') return 1000;
  if (state === 'ownership-drift-observed') return 1500;
  if (state === 'no-caches') return 10000;
  if (state === 'ownership-required' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeShaderOwnershipBoundaryReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: SHADER_OWNERSHIP_BOUNDARY_LIBRARY_ID, libraryVersion: SHADER_OWNERSHIP_BOUNDARY_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    cacheCount: latest?.cacheCount || 0, systemOwnedCount: latest?.systemOwnedCount || 0, userOwnedCount: latest?.userOwnedCount || 0,
    unknownOwnershipCount: latest?.unknownOwnershipCount || 0, comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0), finalEnvironment: latest?.finalEnvironment || 'unknown',
    confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildShaderOwnershipBoundaryPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: SHADER_OWNERSHIP_BOUNDARY_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Ownership-boundary library clock must return a number'); return timestamp; }
export function buildShaderOwnershipBoundaryEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Ownership-boundary library trigger is required');
  return Object.freeze({ library: SHADER_OWNERSHIP_BOUNDARY_LIBRARY_ID, libraryVersion: SHADER_OWNERSHIP_BOUNDARY_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createShaderOwnershipBoundaryLibrary() {
  return Object.freeze({ id: SHADER_OWNERSHIP_BOUNDARY_LIBRARY_ID, version: SHADER_OWNERSHIP_BOUNDARY_LIBRARY_VERSION,
    merge: mergeShaderOwnershipBoundaryReports, plan: buildShaderOwnershipBoundaryPlan, envelope: buildShaderOwnershipBoundaryEnvelope });
}
