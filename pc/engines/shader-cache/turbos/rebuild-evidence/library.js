/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated rebuild-evidence library. It validates stale-cache evidence and
 * builds review plans without executing rebuilds or changing cache files.
 */
export const SHADER_REBUILD_EVIDENCE_LIBRARY_ID = 'shader-cache.rebuild-evidence.library';
export const SHADER_REBUILD_EVIDENCE_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['rebuild-evidence-observed', 'rebuild-evidence-required', 'rebuild-evidence-drift-observed', 'rebuild-evidence-drift-sustained', 'no-stale-caches', 'observation-required', 'no-caches', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Rebuild-evidence library report must be an object');
  if (report.turbo !== 'shader-cache.rebuild-evidence') throw new Error('Rebuild-evidence library requires a rebuild-evidence turbo report');
  if (!STATES.includes(report.state)) throw new Error('Rebuild-evidence library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Rebuild-evidence library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Rebuild-evidence library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Rebuild-evidence library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['cacheCount', 'cache count'], ['staleCount', 'stale count'], ['documentedCount', 'documented count'], ['undocumentedCount', 'undocumented count'], ['unknownEvidenceCount', 'unknown-evidence count'], ['comparisonCount', 'comparison count'], ['changeCount', 'change count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Rebuild-evidence library ${label} must be from 0 to 4096`);
  }
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Rebuild-evidence library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Rebuild-evidence library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Rebuild-evidence library reports must be an array');
  if (reports.length > 64) throw new RangeError('Rebuild-evidence library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'rebuild-evidence-drift-sustained')) return 'rebuild-evidence-drift-sustained';
  if (reports.some((report) => report.state === 'rebuild-evidence-drift-observed')) return 'rebuild-evidence-drift-observed';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  if (reports.some((report) => report.state === 'rebuild-evidence-required')) return 'rebuild-evidence-required';
  if (reports.every((report) => report.state === 'no-caches')) return 'no-caches';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  if (reports.every((report) => report.state === 'no-stale-caches')) return 'no-stale-caches';
  return 'rebuild-evidence-observed';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-rebuild-evidence-samples']);
  if (state === 'no-caches') return Object.freeze(['no-shader-cache-review']);
  if (state === 'observation-required') return Object.freeze(['request-complete-rebuild-evidence']);
  if (state === 'no-stale-caches') return Object.freeze(['no-rebuild-review']);
  if (state === 'rebuild-evidence-required') return Object.freeze(['request-driver-documented-rebuild-path']);
  if (state === 'rebuild-evidence-drift-sustained') return Object.freeze(['review-rebuild-evidence-drift-without-mutation']);
  if (state === 'rebuild-evidence-drift-observed') return Object.freeze(['observe-rebuild-evidence-stability']);
  return Object.freeze(['review-documented-rebuild-path-without-execution']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'no-caches') return 'empty-observation';
  if (state === 'no-stale-caches') return 'no-rebuild-review';
  if (state === 'rebuild-evidence-required') return 'evidence-request';
  if (state === 'rebuild-evidence-drift-sustained') return 'evidence-review';
  if (state === 'rebuild-evidence-drift-observed') return 'evidence-observation';
  if (state === 'observation-required' || state === 'insufficient-data') return 'evidence-bootstrap';
  return 'documented-review';
}
function intervalFor(state, environment) {
  if (state === 'no-caches' || state === 'no-stale-caches') return 10000;
  if (state === 'rebuild-evidence-drift-sustained') return 1000;
  if (state === 'rebuild-evidence-drift-observed' || state === 'rebuild-evidence-required') return 1500;
  if (state === 'observation-required' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeShaderRebuildEvidenceReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: SHADER_REBUILD_EVIDENCE_LIBRARY_ID, libraryVersion: SHADER_REBUILD_EVIDENCE_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    cacheCount: latest?.cacheCount || 0, staleCount: latest?.staleCount || 0, documentedCount: latest?.documentedCount || 0,
    undocumentedCount: latest?.undocumentedCount || 0, unknownEvidenceCount: latest?.unknownEvidenceCount || 0,
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0),
    finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildShaderRebuildEvidencePlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: SHADER_REBUILD_EVIDENCE_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Rebuild-evidence library clock must return a number'); return timestamp; }
export function buildShaderRebuildEvidenceEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Rebuild-evidence library trigger is required');
  return Object.freeze({ library: SHADER_REBUILD_EVIDENCE_LIBRARY_ID, libraryVersion: SHADER_REBUILD_EVIDENCE_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createShaderRebuildEvidenceLibrary() {
  return Object.freeze({ id: SHADER_REBUILD_EVIDENCE_LIBRARY_ID, version: SHADER_REBUILD_EVIDENCE_LIBRARY_VERSION,
    merge: mergeShaderRebuildEvidenceReports, plan: buildShaderRebuildEvidencePlan, envelope: buildShaderRebuildEvidenceEnvelope });
}
