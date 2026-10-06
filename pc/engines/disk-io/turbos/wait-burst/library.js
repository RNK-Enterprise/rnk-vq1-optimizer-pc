/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated wait-burst library. It validates, aggregates, and plans wait
 * reports without importing the turbo or changing disk state.
 */

export const DISK_IO_WAIT_BURST_LIBRARY_ID = 'disk-io.wait-burst.library';
export const DISK_IO_WAIT_BURST_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['wait-burst-sustained', 'wait-burst-observed', 'stable-wait', 'no-disks', 'incomplete-wait-evidence', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireSampleCount(report, field, label) { if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) throw new RangeError(`Wait-burst library report ${label} must fit inside sampleCount`); return report[field]; }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Wait-burst library report must be an object');
  if (report.turbo !== 'disk-io.wait-burst') throw new Error('Wait-burst library requires a wait-burst turbo report');
  if (!STATES.includes(report.state)) throw new Error('Wait-burst library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Wait-burst library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Wait-burst library minimumSamples must be from 1 to 64');
  if (!Number.isFinite(report.waitThreshold) || report.waitThreshold < 0 || report.waitThreshold > 100) throw new RangeError('Wait-burst library waitThreshold must be between 0 and 100');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Wait-burst library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'], ['noDiskCount', 'no-disk count'], ['pressureSampleCount', 'pressure sample count']]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.diskCount) || report.diskCount < 0 || report.diskCount > 4096) throw new RangeError('Wait-burst library diskCount must be from 0 to 4096');
  if (report.maximumWaitPercent !== null && (!Number.isFinite(report.maximumWaitPercent) || report.maximumWaitPercent < 0 || report.maximumWaitPercent > 100)) throw new RangeError('Wait-burst library maximumWaitPercent must be null or from 0 to 100');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Wait-burst library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) { if (!Array.isArray(reports)) throw new TypeError('Wait-burst library reports must be an array'); if (reports.length > 64) throw new RangeError('Wait-burst library accepts at most 64 reports'); return Object.freeze(reports.map(requireReport)); }
function mergedState(reports) { if (reports.length === 0) return 'insufficient-data'; if (reports.some((report) => report.state === 'no-disks')) return 'no-disks'; if (reports.some((report) => report.state === 'incomplete-wait-evidence')) return 'incomplete-wait-evidence'; if (reports.some((report) => report.state === 'wait-burst-sustained')) return 'wait-burst-sustained'; if (reports.some((report) => report.state === 'wait-burst-observed')) return 'wait-burst-observed'; if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data'; return 'stable-wait'; }
function mergedConfidence(reports) { if (reports.length === 0) return 0; const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0); if (samples === 0) return 0; return Math.round((reports.reduce((sum, report) => sum + report.observedCount, 0) / samples) * 10000) / 10000; }
function recommendations(state) { if (state === 'insufficient-data') return Object.freeze(['collect-more-wait-samples']); if (state === 'no-disks') return Object.freeze(['no-disk-io-review']); if (state === 'incomplete-wait-evidence') return Object.freeze(['request-disk-io-observation']); if (state === 'wait-burst-sustained') return Object.freeze(['protect-services', 'review-disk-contention']); if (state === 'wait-burst-observed') return Object.freeze(['observe-next-wait-sample']); return Object.freeze(['no-change']); }
function environmentOf(environment) { return ENVIRONMENTS.includes(environment) ? environment : 'unknown'; }
function planMode(state, environment) { if (environment === 'unknown') return 'profile-required'; if (state === 'wait-burst-sustained') return 'disk-contention-review'; if (state === 'wait-burst-observed') return 'disk-contention-observation'; if (state === 'no-disks') return 'no-disk-observation'; if (state === 'incomplete-wait-evidence') return 'evidence-bootstrap'; if (state === 'insufficient-data') return 'sample-bootstrap'; return 'stable-wait-observation'; }
function intervalFor(state, environment) { if (state === 'wait-burst-sustained') return 750; if (state === 'wait-burst-observed') return 1000; if (state === 'no-disks') return 10000; if (state === 'incomplete-wait-evidence' || state === 'insufficient-data') return 1500; return environment === 'headless' ? 10000 : 5000; }
function latest(reports) { return reports.at(-1) || { diskCount: 0, maximumWaitPercent: null }; }
export function mergeDiskIoWaitBurstReports(reports) { const validated = requireReports(reports); const state = mergedState(validated); const last = latest(validated); return Object.freeze({ library: DISK_IO_WAIT_BURST_LIBRARY_ID, libraryVersion: DISK_IO_WAIT_BURST_LIBRARY_VERSION, reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0), diskCount: last.diskCount, maximumWaitPercent: last.maximumWaitPercent, observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0), noDiskCount: validated.reduce((sum, report) => sum + report.noDiskCount, 0), pressureSampleCount: validated.reduce((sum, report) => sum + report.pressureSampleCount, 0), confidence: mergedConfidence(validated), recommendations: recommendations(state) }); }
export function buildDiskIoWaitBurstPlan(report, environment) { const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment); return Object.freeze({ library: DISK_IO_WAIT_BURST_LIBRARY_ID, environment: normalizedEnvironment, mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment), state: validated.state, confidence: validated.sampleCount === 0 ? 0 : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000 }); }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Wait-burst library clock must return a number'); return timestamp; }
export function buildDiskIoWaitBurstEnvelope(report, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Wait-burst library trigger is required'); return Object.freeze({ library: DISK_IO_WAIT_BURST_LIBRARY_ID, libraryVersion: DISK_IO_WAIT_BURST_LIBRARY_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) }); }
export function createDiskIoWaitBurstLibrary() { return Object.freeze({ id: DISK_IO_WAIT_BURST_LIBRARY_ID, version: DISK_IO_WAIT_BURST_LIBRARY_VERSION, merge: mergeDiskIoWaitBurstReports, plan: buildDiskIoWaitBurstPlan, envelope: buildDiskIoWaitBurstEnvelope }); }
