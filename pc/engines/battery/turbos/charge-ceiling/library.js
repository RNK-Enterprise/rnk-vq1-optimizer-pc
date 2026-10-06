/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated charge-ceiling library. It validates ceiling evidence and builds
 * review plans without imposing limits or changing charging behavior.
 */
export const BATTERY_CHARGE_CEILING_LIBRARY_ID = 'battery.charge-ceiling.library';
export const BATTERY_CHARGE_CEILING_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-ceiling', 'ceiling-observed', 'ceiling-held', 'charge-movement-observed', 'charge-movement-sustained', 'no-battery', 'observation-required', 'ceiling-unknown', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Charge-ceiling library report must be an object');
  if (report.turbo !== 'battery.charge-ceiling') throw new Error('Charge-ceiling library requires a charge-ceiling turbo report');
  if (!STATES.includes(report.state)) throw new Error('Charge-ceiling library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Charge-ceiling library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Charge-ceiling library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Charge-ceiling library persistenceThreshold must be from 1 to 64');
  if (!Number.isInteger(report.ceilingPercent) || report.ceilingPercent < 50 || report.ceilingPercent > 100) throw new RangeError('Charge-ceiling library ceilingPercent must be from 50 to 100');
  if (!Number.isInteger(report.movementThreshold) || report.movementThreshold < 1 || report.movementThreshold > 50) throw new RangeError('Charge-ceiling library movementThreshold must be from 1 to 50');
  for (const [field, label] of [['observedCount', 'observed count'], ['unknownCount', 'unknown count'], ['comparisonCount', 'comparison count'], ['ceilingCount', 'ceiling count'], ['movementCount', 'movement count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Charge-ceiling library ${label} must be from 0 to 4096`);
  }
  if (!Number.isFinite(report.finalChargePercent) && report.finalChargePercent !== null) throw new TypeError('Charge-ceiling library finalChargePercent must be numeric or null');
  if (report.finalChargePercent !== null && (report.finalChargePercent < 0 || report.finalChargePercent > 100)) throw new RangeError('Charge-ceiling library finalChargePercent must be between 0 and 100');
  if (report.finalPresent !== null && typeof report.finalPresent !== 'boolean') throw new TypeError('Charge-ceiling library finalPresent must be boolean or null');
  if (report.finalCharging !== null && typeof report.finalCharging !== 'boolean') throw new TypeError('Charge-ceiling library finalCharging must be boolean or null');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Charge-ceiling library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Charge-ceiling library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Charge-ceiling library reports must be an array');
  if (reports.length > 64) throw new RangeError('Charge-ceiling library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-battery')) return 'no-battery';
  if (reports.some((report) => report.state === 'ceiling-held')) return 'ceiling-held';
  if (reports.some((report) => report.state === 'ceiling-observed')) return 'ceiling-observed';
  if (reports.some((report) => report.state === 'charge-movement-sustained')) return 'charge-movement-sustained';
  if (reports.some((report) => report.state === 'charge-movement-observed')) return 'charge-movement-observed';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  if (reports.every((report) => report.state === 'ceiling-unknown')) return 'ceiling-unknown';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-ceiling';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-ceiling-samples']);
  if (state === 'no-battery') return Object.freeze(['keep-battery-controls-disabled']);
  if (state === 'ceiling-unknown') return Object.freeze(['request-ceiling-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-ceiling-observation']);
  if (state === 'ceiling-held') return Object.freeze(['review-ceiling-evidence-without-limit-change']);
  if (state === 'ceiling-observed') return Object.freeze(['observe-charge-ceiling']);
  if (state === 'charge-movement-sustained') return Object.freeze(['review-charge-movement-without-control-change']);
  if (state === 'charge-movement-observed') return Object.freeze(['observe-charge-movement']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'no-battery') return 'empty-observation';
  if (state === 'ceiling-held') return 'ceiling-review';
  if (state === 'ceiling-observed') return 'ceiling-observation';
  if (state === 'charge-movement-sustained') return 'movement-review';
  if (state === 'charge-movement-observed') return 'movement-observation';
  if (state === 'observation-required' || state === 'ceiling-unknown' || state === 'insufficient-data') return 'evidence-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'ceiling-held') return 750;
  if (state === 'ceiling-observed' || state === 'charge-movement-observed') return 1500;
  if (state === 'charge-movement-sustained') return 1000;
  if (state === 'no-battery') return 10000;
  if (state === 'observation-required' || state === 'ceiling-unknown' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeBatteryChargeCeilingReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: BATTERY_CHARGE_CEILING_LIBRARY_ID, libraryVersion: BATTERY_CHARGE_CEILING_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), ceilingCount: validated.reduce((sum, report) => sum + report.ceilingCount, 0),
    movementCount: validated.reduce((sum, report) => sum + report.movementCount, 0), ceilingPercent: latest?.ceilingPercent || 0,
    movementThreshold: latest?.movementThreshold || 0, finalChargePercent: latest?.finalChargePercent ?? null,
    finalPresent: latest?.finalPresent ?? null, finalCharging: latest?.finalCharging ?? null, finalEnvironment: latest?.finalEnvironment || 'unknown',
    confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildBatteryChargeCeilingPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: BATTERY_CHARGE_CEILING_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Charge-ceiling library clock must return a number'); return timestamp; }
export function buildBatteryChargeCeilingEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Charge-ceiling library trigger is required');
  return Object.freeze({ library: BATTERY_CHARGE_CEILING_LIBRARY_ID, libraryVersion: BATTERY_CHARGE_CEILING_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createBatteryChargeCeilingLibrary() {
  return Object.freeze({ id: BATTERY_CHARGE_CEILING_LIBRARY_ID, version: BATTERY_CHARGE_CEILING_LIBRARY_VERSION,
    merge: mergeBatteryChargeCeilingReports, plan: buildBatteryChargeCeilingPlan, envelope: buildBatteryChargeCeilingEnvelope });
}
