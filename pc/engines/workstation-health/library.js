/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Workstation-health library. It merges bounded daily reports into a review
 * record and never mutates host state.
 */

export const WORKSTATION_HEALTH_LIBRARY_ID = 'workstation-health-library';
export const WORKSTATION_HEALTH_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['healthy', 'warning', 'critical', 'observation-required']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Workstation-health library report must be an object');
  if (report.engine !== 'workstation-health') throw new Error('Workstation-health library requires a workstation-health report');
  if (!STATES.includes(report.state)) throw new Error('Workstation-health library report has an invalid state');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Workstation-health library report confidence must be between 0 and 1');
  if (!Array.isArray(report.problemCodes) || !Array.isArray(report.recommendations)) throw new TypeError('Workstation-health library report requires problem and recommendation lists');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Workstation-health library reports must be an array');
  if (reports.length > 64) throw new RangeError('Workstation-health library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.some((report) => report.state === 'critical')) return 'critical';
  if (reports.some((report) => report.state === 'warning')) return 'warning';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  return reports.length ? 'healthy' : 'observation-required';
}
function uniqueValues(reports, field) { return Object.freeze([...new Set(reports.flatMap((report) => report[field]))]); }
function recoveredBytes(reports) { return reports.reduce((total, report) => total + (Number.isFinite(report.cleanup?.recoveredBytes) ? report.cleanup.recoveredBytes : 0), 0); }
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function recommendations(state, problems) {
  if (state === 'critical') return Object.freeze(['review-critical-workstation-problems', ...problems.filter((item) => item.includes('storage'))]);
  if (state === 'warning') return Object.freeze(['review-workstation-warnings']);
  if (state === 'observation-required') return Object.freeze(['collect-complete-workstation-evidence']);
  return Object.freeze(['no-change']);
}
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'critical') return 'critical-review';
  if (state === 'warning') return 'warning-review';
  if (state === 'observation-required') return 'evidence-bootstrap';
  return 'daily-observation';
}
function intervalFor(state, environment) {
  if (state === 'critical') return 300000;
  if (state === 'warning') return 3600000;
  if (state === 'observation-required') return 900000;
  return environment === 'headless' ? 86400000 : 86400000;
}

export function mergeWorkstationHealthReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const problems = uniqueValues(validated, 'problemCodes');
  const confidence = validated.length ? Math.round((validated.reduce((sum, report) => sum + report.confidence, 0) / validated.length) * 10000) / 10000 : 0;
  const latest = validated.at(-1) || null;
  return Object.freeze({ library: WORKSTATION_HEALTH_LIBRARY_ID, libraryVersion: WORKSTATION_HEALTH_LIBRARY_VERSION, reportCount: validated.length, state, environment: latest?.environment || 'unknown', confidence, problemCodes: problems, cleanupRecoveredBytes: recoveredBytes(validated), latestGeneratedAt: latest?.generatedAt || null, recommendations: recommendations(state, problems) });
}

export function buildWorkstationHealthPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: WORKSTATION_HEALTH_LIBRARY_ID, environment: normalizedEnvironment, mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment), state: validated.state, confidence: validated.confidence });
}

function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workstation-health library clock must return a number'); return timestamp; }
export function buildWorkstationHealthEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || !trigger) throw new TypeError('Workstation-health library trigger is required');
  return Object.freeze({ library: WORKSTATION_HEALTH_LIBRARY_ID, libraryVersion: WORKSTATION_HEALTH_LIBRARY_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createWorkstationHealthLibrary() {
  return Object.freeze({ id: WORKSTATION_HEALTH_LIBRARY_ID, version: WORKSTATION_HEALTH_LIBRARY_VERSION, merge: mergeWorkstationHealthReports, plan: buildWorkstationHealthPlan, envelope: buildWorkstationHealthEnvelope });
}
