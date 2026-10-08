/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated charge-trend library. It validates and plans charge evidence
 * without importing a charging or power-policy control API.
 */
export const BATTERY_CHARGE_TREND_LIBRARY_ID = 'battery.charge-trend.library';
export const BATTERY_CHARGE_TREND_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-charge', 'charge-drift-observed', 'charge-falling-sustained', 'charge-rising-sustained', 'low-charge', 'observation-required', 'charge-unknown', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Charge-trend library report must be an object');
  if (report.turbo !== 'battery.charge-trend') throw new Error('Charge-trend library requires a charge-trend turbo report');
  if (!STATES.includes(report.state)) throw new Error('Charge-trend library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Charge-trend library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Charge-trend library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Charge-trend library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['observedCount', 'observed count'], ['unknownCount', 'unknown count'], ['comparisonCount', 'comparison count'], ['changedCount', 'changed count'], ['risingCount', 'rising count'], ['fallingCount', 'falling count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Charge-trend library ${label} must be from 0 to 4096`);
  }
  if (!Number.isFinite(report.finalChargePercent) && report.finalChargePercent !== null) throw new TypeError('Charge-trend library finalChargePercent must be numeric or null');
  if (report.finalChargePercent !== null && (report.finalChargePercent < 0 || report.finalChargePercent > 100)) throw new RangeError('Charge-trend library finalChargePercent must be between 0 and 100');
  if (report.finalCharging !== null && typeof report.finalCharging !== 'boolean') throw new TypeError('Charge-trend library finalCharging must be boolean or null');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Charge-trend library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Charge-trend library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Charge-trend library reports must be an array');
  if (reports.length > 64) throw new RangeError('Charge-trend library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'low-charge')) return 'low-charge';
  if (reports.some((report) => report.state === 'charge-falling-sustained')) return 'charge-falling-sustained';
  if (reports.some((report) => report.state === 'charge-rising-sustained')) return 'charge-rising-sustained';
  if (reports.some((report) => report.state === 'charge-drift-observed')) return 'charge-drift-observed';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  if (reports.every((report) => report.state === 'charge-unknown')) return 'charge-unknown';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-charge';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-charge-samples']);
  if (state === 'charge-unknown') return Object.freeze(['request-charge-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-charge-observation']);
  if (state === 'low-charge') return Object.freeze(['review-user-owned-power-policy']);
  if (state === 'charge-falling-sustained') return Object.freeze(['review-charge-loss-without-charging-change']);
  if (state === 'charge-rising-sustained') return Object.freeze(['observe-charge-recovery']);
  if (state === 'charge-drift-observed') return Object.freeze(['observe-charge-stability']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'low-charge') return 'power-review';
  if (state === 'charge-falling-sustained') return 'charge-loss-review';
  if (state === 'charge-rising-sustained') return 'recovery-observation';
  if (state === 'charge-drift-observed') return 'trend-observation';
  if (state === 'observation-required') return 'evidence-bootstrap';
  if (state === 'charge-unknown' || state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'low-charge') return 750;
  if (state === 'charge-falling-sustained') return 1000;
  if (state === 'charge-rising-sustained') return 1500;
  if (state === 'charge-drift-observed') return 2000;
  if (state === 'observation-required' || state === 'charge-unknown' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeBatteryChargeTrendReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: BATTERY_CHARGE_TREND_LIBRARY_ID, libraryVersion: BATTERY_CHARGE_TREND_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), changedCount: validated.reduce((sum, report) => sum + report.changedCount, 0),
    risingCount: validated.reduce((sum, report) => sum + report.risingCount, 0), fallingCount: validated.reduce((sum, report) => sum + report.fallingCount, 0),
    finalChargePercent: latest?.finalChargePercent ?? null, finalCharging: latest?.finalCharging ?? null,
    finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildBatteryChargeTrendPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: BATTERY_CHARGE_TREND_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Charge-trend library clock must return a number'); return timestamp; }
export function buildBatteryChargeTrendEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Charge-trend library trigger is required');
  return Object.freeze({ library: BATTERY_CHARGE_TREND_LIBRARY_ID, libraryVersion: BATTERY_CHARGE_TREND_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createBatteryChargeTrendLibrary() {
  return Object.freeze({ id: BATTERY_CHARGE_TREND_LIBRARY_ID, version: BATTERY_CHARGE_TREND_LIBRARY_VERSION,
    merge: mergeBatteryChargeTrendReports, plan: buildBatteryChargeTrendPlan, envelope: buildBatteryChargeTrendEnvelope });
}
