/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated ownership-boundary library. It validates startup ownership
 * evidence and builds review plans without changing boot configuration.
 */
export const STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_ID = 'startup.ownership-boundary.library';
export const STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-ownership', 'ownership-drift-observed', 'ownership-drift-sustained', 'user-owned-review', 'ownership-required', 'no-startup-items', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Ownership-boundary library report must be an object');
  if (report.turbo !== 'startup.ownership-boundary') throw new Error('Ownership-boundary library requires an ownership-boundary turbo report');
  if (!STATES.includes(report.state)) throw new Error('Ownership-boundary library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Ownership-boundary library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Ownership-boundary library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Ownership-boundary library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['entryCount', 'entry count'], ['userOwnedCount', 'user-owned count'], ['systemOwnedCount', 'system-owned count'], ['unknownOwnershipCount', 'unknown-ownership count'], ['userOwnedEnabledCount', 'user-owned enabled count'], ['comparisonCount', 'comparison count'], ['changeCount', 'change count']]) {
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
  if (reports.some((report) => report.state === 'ownership-required')) return 'ownership-required';
  if (reports.some((report) => report.state === 'user-owned-review')) return 'user-owned-review';
  if (reports.some((report) => report.state === 'ownership-drift-sustained')) return 'ownership-drift-sustained';
  if (reports.some((report) => report.state === 'ownership-drift-observed')) return 'ownership-drift-observed';
  if (reports.every((report) => report.state === 'no-startup-items')) return 'no-startup-items';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-ownership';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-startup-ownership-samples']);
  if (state === 'no-startup-items') return Object.freeze(['no-startup-review']);
  if (state === 'ownership-required') return Object.freeze(['request-startup-ownership']);
  if (state === 'user-owned-review') return Object.freeze(['preserve-user-owned-startup-boundary']);
  if (state === 'ownership-drift-sustained') return Object.freeze(['review-startup-ownership-drift-without-mutation']);
  if (state === 'ownership-drift-observed') return Object.freeze(['observe-startup-ownership-stability']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'no-startup-items') return 'empty-observation';
  if (state === 'ownership-required') return 'ownership-evidence-review';
  if (state === 'user-owned-review') return 'user-owned-review';
  if (state === 'ownership-drift-sustained') return 'ownership-drift-review';
  if (state === 'ownership-drift-observed') return 'ownership-drift-observation';
  if (state === 'insufficient-data') return 'evidence-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'ownership-required') return 750;
  if (state === 'user-owned-review') return 1000;
  if (state === 'ownership-drift-sustained') return 1250;
  if (state === 'ownership-drift-observed') return 1500;
  if (state === 'insufficient-data') return 2000;
  if (state === 'no-startup-items') return 10000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeStartupOwnershipBoundaryReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_ID, libraryVersion: STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0), entryCount: latest?.entryCount || 0,
    userOwnedCount: latest?.userOwnedCount || 0, systemOwnedCount: latest?.systemOwnedCount || 0, unknownOwnershipCount: latest?.unknownOwnershipCount || 0,
    userOwnedEnabledCount: latest?.userOwnedEnabledCount || 0, comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0), finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0,
    recommendations: recommendations(state) });
}
export function buildStartupOwnershipBoundaryPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Ownership-boundary library clock must return a number'); return timestamp; }
export function buildStartupOwnershipBoundaryEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Ownership-boundary library trigger is required');
  return Object.freeze({ library: STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_ID, libraryVersion: STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createStartupOwnershipBoundaryLibrary() {
  return Object.freeze({ id: STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_ID, version: STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_VERSION,
    merge: mergeStartupOwnershipBoundaryReports, plan: buildStartupOwnershipBoundaryPlan, envelope: buildStartupOwnershipBoundaryEnvelope });
}
