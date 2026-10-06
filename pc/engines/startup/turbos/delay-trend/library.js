/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated delay-trend library. It validates startup delay evidence and
 * builds observation plans without changing boot configuration or files.
 */
export const STARTUP_DELAY_TREND_LIBRARY_ID = 'startup.delay-trend.library';
export const STARTUP_DELAY_TREND_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-delay', 'delay-rising-observed', 'delay-rising-sustained', 'delay-falling-observed', 'delay-falling-sustained', 'delay-observation-required', 'delay-unknown', 'no-startup-items', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Delay-trend library report must be an object');
  if (report.turbo !== 'startup.delay-trend') throw new Error('Delay-trend library requires a delay-trend turbo report');
  if (!STATES.includes(report.state)) throw new Error('Delay-trend library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Delay-trend library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Delay-trend library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Delay-trend library persistenceThreshold must be from 1 to 64');
  if (!Number.isFinite(report.delayThresholdMs) || report.delayThresholdMs < 1 || report.delayThresholdMs > 5000) throw new RangeError('Delay-trend library delayThresholdMs must be from 1 to 5000');
  for (const [field, label] of [['observedCount', 'observed count'], ['unknownCount', 'unknown count'], ['comparisonCount', 'comparison count'], ['changedCount', 'changed count'], ['risingCount', 'rising count'], ['fallingCount', 'falling count'], ['finalEntryCount', 'final entry count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Delay-trend library ${label} must be from 0 to 4096`);
  }
  if (!Number.isFinite(report.finalMaximumDelayMs) && report.finalMaximumDelayMs !== null) throw new TypeError('Delay-trend library final maximum delay must be numeric or null');
  if (report.finalMaximumDelayMs !== null && report.finalMaximumDelayMs < 0) throw new RangeError('Delay-trend library final maximum delay must be non-negative');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Delay-trend library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Delay-trend library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Delay-trend library reports must be an array');
  if (reports.length > 64) throw new RangeError('Delay-trend library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'delay-rising-sustained')) return 'delay-rising-sustained';
  if (reports.some((report) => report.state === 'delay-falling-sustained')) return 'delay-falling-sustained';
  if (reports.some((report) => report.state === 'delay-rising-observed')) return 'delay-rising-observed';
  if (reports.some((report) => report.state === 'delay-falling-observed')) return 'delay-falling-observed';
  if (reports.some((report) => report.state === 'delay-observation-required')) return 'delay-observation-required';
  if (reports.every((report) => report.state === 'delay-unknown')) return 'delay-unknown';
  if (reports.every((report) => report.state === 'no-startup-items')) return 'no-startup-items';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-delay';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-startup-delay-samples']);
  if (state === 'no-startup-items') return Object.freeze(['no-startup-review']);
  if (state === 'delay-unknown') return Object.freeze(['request-startup-delay-observation']);
  if (state === 'delay-observation-required') return Object.freeze(['request-complete-startup-delay-observation']);
  if (state === 'delay-rising-sustained') return Object.freeze(['review-startup-delay-growth-without-mutation']);
  if (state === 'delay-falling-sustained') return Object.freeze(['observe-startup-delay-recovery']);
  if (state === 'delay-rising-observed') return Object.freeze(['observe-startup-delay-stability']);
  if (state === 'delay-falling-observed') return Object.freeze(['observe-startup-delay-recovery']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'no-startup-items') return 'empty-observation';
  if (state === 'delay-unknown' || state === 'delay-observation-required' || state === 'insufficient-data') return 'evidence-bootstrap';
  if (state === 'delay-rising-sustained') return 'delay-growth-review';
  if (state === 'delay-falling-sustained') return 'delay-recovery-review';
  if (state === 'delay-rising-observed') return 'delay-growth-observation';
  if (state === 'delay-falling-observed') return 'delay-recovery-observation';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'delay-rising-sustained') return 1000;
  if (state === 'delay-falling-sustained') return 1250;
  if (state === 'delay-rising-observed' || state === 'delay-falling-observed') return 1500;
  if (state === 'delay-unknown' || state === 'delay-observation-required' || state === 'insufficient-data') return 2000;
  if (state === 'no-startup-items') return 10000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeStartupDelayTrendReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: STARTUP_DELAY_TREND_LIBRARY_ID, libraryVersion: STARTUP_DELAY_TREND_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), changedCount: validated.reduce((sum, report) => sum + report.changedCount, 0),
    risingCount: validated.reduce((sum, report) => sum + report.risingCount, 0), fallingCount: validated.reduce((sum, report) => sum + report.fallingCount, 0),
    delayThresholdMs: latest?.delayThresholdMs || 0, finalMaximumDelayMs: latest?.finalMaximumDelayMs ?? null, finalEntryCount: latest?.finalEntryCount || 0,
    finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildStartupDelayTrendPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: STARTUP_DELAY_TREND_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Delay-trend library clock must return a number'); return timestamp; }
export function buildStartupDelayTrendEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Delay-trend library trigger is required');
  return Object.freeze({ library: STARTUP_DELAY_TREND_LIBRARY_ID, libraryVersion: STARTUP_DELAY_TREND_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createStartupDelayTrendLibrary() {
  return Object.freeze({ id: STARTUP_DELAY_TREND_LIBRARY_ID, version: STARTUP_DELAY_TREND_LIBRARY_VERSION,
    merge: mergeStartupDelayTrendReports, plan: buildStartupDelayTrendPlan, envelope: buildStartupDelayTrendEnvelope });
}
