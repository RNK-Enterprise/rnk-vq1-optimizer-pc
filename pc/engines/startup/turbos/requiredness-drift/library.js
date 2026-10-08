/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated requiredness-drift library. It validates required-flag evidence
 * and builds review plans without changing boot configuration or files.
 */
export const STARTUP_REQUIREDNESS_DRIFT_LIBRARY_ID = 'startup.requiredness-drift.library';
export const STARTUP_REQUIREDNESS_DRIFT_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-requiredness', 'requiredness-drift-observed', 'requiredness-drift-sustained', 'required-disabled-review', 'no-startup-items', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Requiredness-drift library report must be an object');
  if (report.turbo !== 'startup.requiredness-drift') throw new Error('Requiredness-drift library requires a requiredness-drift turbo report');
  if (!STATES.includes(report.state)) throw new Error('Requiredness-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Requiredness-drift library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Requiredness-drift library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Requiredness-drift library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['entryCount', 'entry count'], ['requiredCount', 'required count'], ['requiredDisabledCount', 'required-disabled count'], ['comparisonCount', 'comparison count'], ['changeCount', 'change count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Requiredness-drift library ${label} must be from 0 to 4096`);
  }
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Requiredness-drift library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Requiredness-drift library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Requiredness-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Requiredness-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'required-disabled-review')) return 'required-disabled-review';
  if (reports.some((report) => report.state === 'requiredness-drift-sustained')) return 'requiredness-drift-sustained';
  if (reports.some((report) => report.state === 'requiredness-drift-observed')) return 'requiredness-drift-observed';
  if (reports.every((report) => report.state === 'no-startup-items')) return 'no-startup-items';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-requiredness';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-startup-requiredness-samples']);
  if (state === 'no-startup-items') return Object.freeze(['no-startup-review']);
  if (state === 'required-disabled-review') return Object.freeze(['review-required-startup-owner']);
  if (state === 'requiredness-drift-sustained') return Object.freeze(['review-startup-requiredness-drift-without-mutation']);
  if (state === 'requiredness-drift-observed') return Object.freeze(['observe-startup-requiredness-stability']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'no-startup-items') return 'empty-observation';
  if (state === 'required-disabled-review') return 'required-startup-review';
  if (state === 'requiredness-drift-sustained') return 'requiredness-drift-review';
  if (state === 'requiredness-drift-observed') return 'requiredness-drift-observation';
  if (state === 'insufficient-data') return 'evidence-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'required-disabled-review') return 750;
  if (state === 'requiredness-drift-sustained') return 1250;
  if (state === 'requiredness-drift-observed') return 1500;
  if (state === 'insufficient-data') return 2000;
  if (state === 'no-startup-items') return 10000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeStartupRequirednessDriftReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: STARTUP_REQUIREDNESS_DRIFT_LIBRARY_ID, libraryVersion: STARTUP_REQUIREDNESS_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0), entryCount: latest?.entryCount || 0,
    requiredCount: latest?.requiredCount || 0, requiredDisabledCount: latest?.requiredDisabledCount || 0,
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0),
    finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildStartupRequirednessDriftPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: STARTUP_REQUIREDNESS_DRIFT_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Requiredness-drift library clock must return a number'); return timestamp; }
export function buildStartupRequirednessDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Requiredness-drift library trigger is required');
  return Object.freeze({ library: STARTUP_REQUIREDNESS_DRIFT_LIBRARY_ID, libraryVersion: STARTUP_REQUIREDNESS_DRIFT_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createStartupRequirednessDriftLibrary() {
  return Object.freeze({ id: STARTUP_REQUIREDNESS_DRIFT_LIBRARY_ID, version: STARTUP_REQUIREDNESS_DRIFT_LIBRARY_VERSION,
    merge: mergeStartupRequirednessDriftReports, plan: buildStartupRequirednessDriftPlan, envelope: buildStartupRequirednessDriftEnvelope });
}
