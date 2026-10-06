/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated cooldown-recovery library. It validates temperature movement and
 * builds observation plans without importing thermal control APIs.
 */
export const THERMAL_COOLDOWN_RECOVERY_LIBRARY_ID = 'thermal.cooldown-recovery.library';
export const THERMAL_COOLDOWN_RECOVERY_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-temperature', 'cooldown-recovery-observed', 'cooldown-recovery-sustained', 'thermal-rebound-observed', 'thermal-rebound-sustained', 'observation-required', 'recovery-unknown', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Cooldown-recovery library report must be an object');
  if (report.turbo !== 'thermal.cooldown-recovery') throw new Error('Cooldown-recovery library requires a cooldown-recovery turbo report');
  if (!STATES.includes(report.state)) throw new Error('Cooldown-recovery library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Cooldown-recovery library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Cooldown-recovery library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Cooldown-recovery library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['observedCount', 'observed count'], ['unknownCount', 'unknown count'], ['comparisonCount', 'comparison count'], ['changedCount', 'changed count'], ['recoveryCount', 'recovery count'], ['reboundCount', 'rebound count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Cooldown-recovery library ${label} must be from 0 to 4096`);
  }
  if (!Number.isFinite(report.finalTemperatureCelsius) && report.finalTemperatureCelsius !== null) throw new TypeError('Cooldown-recovery library final temperature must be numeric or null');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Cooldown-recovery library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Cooldown-recovery library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Cooldown-recovery library reports must be an array');
  if (reports.length > 64) throw new RangeError('Cooldown-recovery library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'cooldown-recovery-sustained')) return 'cooldown-recovery-sustained';
  if (reports.some((report) => report.state === 'thermal-rebound-sustained')) return 'thermal-rebound-sustained';
  if (reports.some((report) => report.state === 'cooldown-recovery-observed')) return 'cooldown-recovery-observed';
  if (reports.some((report) => report.state === 'thermal-rebound-observed')) return 'thermal-rebound-observed';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  if (reports.every((report) => report.state === 'recovery-unknown')) return 'recovery-unknown';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-temperature';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cooldown-samples']);
  if (state === 'recovery-unknown') return Object.freeze(['request-cooldown-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-cooldown-observation']);
  if (state === 'cooldown-recovery-sustained') return Object.freeze(['observe-cooldown-recovery']);
  if (state === 'thermal-rebound-sustained') return Object.freeze(['review-thermal-rebound-without-mutation']);
  if (state === 'cooldown-recovery-observed') return Object.freeze(['observe-cooldown-stability']);
  if (state === 'thermal-rebound-observed') return Object.freeze(['observe-thermal-rebound-stability']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'cooldown-recovery-sustained') return 'cooldown-review';
  if (state === 'thermal-rebound-sustained') return 'rebound-review';
  if (state === 'cooldown-recovery-observed') return 'cooldown-observation';
  if (state === 'thermal-rebound-observed') return 'rebound-observation';
  if (state === 'observation-required' || state === 'recovery-unknown' || state === 'insufficient-data') return 'evidence-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'cooldown-recovery-sustained') return 1000;
  if (state === 'thermal-rebound-sustained') return 750;
  if (state === 'cooldown-recovery-observed' || state === 'thermal-rebound-observed') return 1500;
  if (state === 'observation-required' || state === 'recovery-unknown' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeThermalCooldownRecoveryReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: THERMAL_COOLDOWN_RECOVERY_LIBRARY_ID, libraryVersion: THERMAL_COOLDOWN_RECOVERY_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), changedCount: validated.reduce((sum, report) => sum + report.changedCount, 0),
    recoveryCount: validated.reduce((sum, report) => sum + report.recoveryCount, 0), reboundCount: validated.reduce((sum, report) => sum + report.reboundCount, 0),
    finalTemperatureCelsius: latest?.finalTemperatureCelsius ?? null, finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0,
    recommendations: recommendations(state) });
}
export function buildThermalCooldownRecoveryPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: THERMAL_COOLDOWN_RECOVERY_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Cooldown-recovery library clock must return a number'); return timestamp; }
export function buildThermalCooldownRecoveryEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Cooldown-recovery library trigger is required');
  return Object.freeze({ library: THERMAL_COOLDOWN_RECOVERY_LIBRARY_ID, libraryVersion: THERMAL_COOLDOWN_RECOVERY_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createThermalCooldownRecoveryLibrary() {
  return Object.freeze({ id: THERMAL_COOLDOWN_RECOVERY_LIBRARY_ID, version: THERMAL_COOLDOWN_RECOVERY_LIBRARY_VERSION,
    merge: mergeThermalCooldownRecoveryReports, plan: buildThermalCooldownRecoveryPlan, envelope: buildThermalCooldownRecoveryEnvelope });
}
