/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated ownership-review library. It validates and plans service-owner
 * evidence without changing service ownership or importing a control API.
 */
export const BACKGROUND_OWNERSHIP_LIBRARY_ID = 'background-services.ownership-review.library';
export const BACKGROUND_OWNERSHIP_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['system-owned-observe', 'ownership-observation-required', 'user-owned-review', 'no-services', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Ownership library report must be an object');
  if (report.turbo !== 'background-services.ownership-review') throw new Error('Ownership library requires an ownership-review turbo report');
  if (!STATES.includes(report.state)) throw new Error('Ownership library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Ownership library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Ownership library minimumSamples must be from 1 to 64');
  for (const [field, label] of [['serviceCount', 'service count'], ['userOwnedCount', 'user-owned count'], ['systemOwnedCount', 'system-owned count'], ['unknownOwnershipCount', 'unknown-ownership count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Ownership library ${label} must be from 0 to 4096`);
  }
  if (!Number.isInteger(report.comparisonCount) || report.comparisonCount < 0 || report.comparisonCount > Math.max(0, report.sampleCount - 1)) throw new RangeError('Ownership library comparisonCount must fit inside the sample window');
  if (!Number.isInteger(report.changeCount) || report.changeCount < 0 || report.changeCount > report.comparisonCount) throw new RangeError('Ownership library changeCount must fit inside comparisonCount');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Ownership library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Ownership library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Ownership library reports must be an array');
  if (reports.length > 64) throw new RangeError('Ownership library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'user-owned-review')) return 'user-owned-review';
  if (reports.some((report) => report.state === 'ownership-observation-required')) return 'ownership-observation-required';
  if (reports.every((report) => report.state === 'no-services')) return 'no-services';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'system-owned-observe';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-service-ownership-samples']);
  if (state === 'no-services') return Object.freeze(['no-background-service-review']);
  if (state === 'user-owned-review') return Object.freeze(['preserve-user-owned-service-boundary']);
  if (state === 'ownership-observation-required') return Object.freeze(['request-explicit-service-ownership']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'user-owned-review') return 'user-boundary';
  if (state === 'ownership-observation-required') return 'ownership-bootstrap';
  if (state === 'no-services') return 'empty-observation';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'user-owned-review') return 750;
  if (state === 'ownership-observation-required' || state === 'insufficient-data') return 2000;
  if (state === 'no-services') return 10000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeBackgroundOwnershipReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: BACKGROUND_OWNERSHIP_LIBRARY_ID, libraryVersion: BACKGROUND_OWNERSHIP_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    serviceCount: latest?.serviceCount || 0, userOwnedCount: latest?.userOwnedCount || 0,
    systemOwnedCount: latest?.systemOwnedCount || 0, unknownOwnershipCount: latest?.unknownOwnershipCount || 0,
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0),
    finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0,
    recommendations: recommendations(state) });
}
export function buildBackgroundOwnershipPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: BACKGROUND_OWNERSHIP_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Ownership library clock must return a number'); return timestamp; }
export function buildBackgroundOwnershipEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Ownership library trigger is required');
  return Object.freeze({ library: BACKGROUND_OWNERSHIP_LIBRARY_ID, libraryVersion: BACKGROUND_OWNERSHIP_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createBackgroundOwnershipLibrary() {
  return Object.freeze({ id: BACKGROUND_OWNERSHIP_LIBRARY_ID, version: BACKGROUND_OWNERSHIP_LIBRARY_VERSION,
    merge: mergeBackgroundOwnershipReports, plan: buildBackgroundOwnershipPlan, envelope: buildBackgroundOwnershipEnvelope });
}
