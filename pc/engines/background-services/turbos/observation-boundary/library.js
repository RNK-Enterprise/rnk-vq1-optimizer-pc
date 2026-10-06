/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated observation-boundary library. It validates capability evidence
 * and plans observation without enabling, disabling, or controlling services.
 */
export const BACKGROUND_OBSERVATION_LIBRARY_ID = 'background-services.observation-boundary.library';
export const BACKGROUND_OBSERVATION_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['observation-enabled', 'observation-disabled', 'observation-capability-unknown', 'no-services', 'insufficient-data']);
const OBSERVATIONS = Object.freeze(['enabled', 'disabled', 'unknown']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Observation library report must be an object');
  if (report.turbo !== 'background-services.observation-boundary') throw new Error('Observation library requires an observation-boundary turbo report');
  if (!STATES.includes(report.state)) throw new Error('Observation library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Observation library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Observation library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.serviceCount) || report.serviceCount < 0 || report.serviceCount > 4096) throw new RangeError('Observation library service count must be from 0 to 4096');
  if (!OBSERVATIONS.includes(report.observation)) throw new TypeError('Observation library observation must be normalized');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Observation library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Observation library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Observation library reports must be an array');
  if (reports.length > 64) throw new RangeError('Observation library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'observation-disabled')) return 'observation-disabled';
  if (reports.some((report) => report.state === 'observation-capability-unknown')) return 'observation-capability-unknown';
  if (reports.every((report) => report.state === 'no-services')) return 'no-services';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'observation-enabled';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-observation-samples']);
  if (state === 'no-services') return Object.freeze(['no-background-service-review']);
  if (state === 'observation-disabled') return Object.freeze(['keep-service-observation-disabled']);
  if (state === 'observation-capability-unknown') return Object.freeze(['request-observation-capability']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'observation-disabled') return 'disabled-preservation';
  if (state === 'observation-capability-unknown') return 'capability-bootstrap';
  if (state === 'no-services') return 'empty-observation';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'observation-disabled' || state === 'no-services') return 10000;
  if (state === 'observation-capability-unknown' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeBackgroundObservationReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: BACKGROUND_OBSERVATION_LIBRARY_ID, libraryVersion: BACKGROUND_OBSERVATION_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    serviceCount: latest?.serviceCount || 0, observation: latest?.observation || 'unknown',
    finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0,
    recommendations: recommendations(state) });
}
export function buildBackgroundObservationPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: BACKGROUND_OBSERVATION_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Observation library clock must return a number'); return timestamp; }
export function buildBackgroundObservationEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Observation library trigger is required');
  return Object.freeze({ library: BACKGROUND_OBSERVATION_LIBRARY_ID, libraryVersion: BACKGROUND_OBSERVATION_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createBackgroundObservationLibrary() {
  return Object.freeze({ id: BACKGROUND_OBSERVATION_LIBRARY_ID, version: BACKGROUND_OBSERVATION_LIBRARY_VERSION,
    merge: mergeBackgroundObservationReports, plan: buildBackgroundObservationPlan, envelope: buildBackgroundObservationEnvelope });
}
