/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated mesh-evidence library. It validates, aggregates, and plans mesh
 * membership reports without importing the turbo or changing network state.
 */

export const NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_ID = 'network-observation.mesh-evidence.library';
export const NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'mesh-drift-sustained', 'mesh-drift-observed', 'stable-mesh-evidence',
  'no-network', 'incomplete-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Mesh-evidence library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Mesh-evidence library report must be an object');
  if (report.turbo !== 'network-observation.mesh-evidence') {
    throw new Error('Mesh-evidence library requires a mesh-evidence turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Mesh-evidence library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Mesh-evidence library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Mesh-evidence library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Mesh-evidence library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noNetworkCount', 'no-network count'], ['comparisonCount', 'comparison count'],
    ['meshChangeSampleCount', 'mesh-change sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.linkCount) || report.linkCount < 0 || report.linkCount > 4096) {
    throw new RangeError('Mesh-evidence library linkCount must be from 0 to 4096');
  }
  if (!Number.isInteger(report.meshCount) || report.meshCount < 0 || report.meshCount > report.linkCount) {
    throw new RangeError('Mesh-evidence library meshCount must fit inside linkCount');
  }
  if (!Number.isInteger(report.unknownMeshCount) || report.unknownMeshCount < 0
    || report.unknownMeshCount > report.linkCount) {
    throw new RangeError('Mesh-evidence library unknownMeshCount must fit inside linkCount');
  }
  if (!Number.isInteger(report.meshChangeCount) || report.meshChangeCount < 0
    || report.meshChangeCount > 8192) {
    throw new RangeError('Mesh-evidence library meshChangeCount must be from 0 to 8192');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Mesh-evidence library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Mesh-evidence library reports must be an array');
  if (reports.length > 64) throw new RangeError('Mesh-evidence library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-network')) return 'no-network';
  if (reports.some((report) => report.state === 'incomplete-evidence')) return 'incomplete-evidence';
  if (reports.some((report) => report.state === 'mesh-drift-sustained')) return 'mesh-drift-sustained';
  if (reports.some((report) => report.state === 'mesh-drift-observed')) return 'mesh-drift-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-mesh-evidence';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-mesh-evidence']);
  if (state === 'no-network') return Object.freeze(['no-network-mesh-review']);
  if (state === 'incomplete-evidence') return Object.freeze(['request-explicit-mesh-evidence']);
  if (state === 'mesh-drift-sustained') return Object.freeze(['review-mesh-evidence-drift-without-network-mutation']);
  if (state === 'mesh-drift-observed') return Object.freeze(['observe-mesh-evidence-stability']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'mesh-drift-sustained') return 'mesh-evidence-review';
  if (state === 'mesh-drift-observed') return 'mesh-evidence-observation';
  if (state === 'no-network') return 'no-network-observation';
  if (state === 'incomplete-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-mesh-observation';
}

function intervalFor(state, environment) {
  if (state === 'mesh-drift-sustained') return 750;
  if (state === 'mesh-drift-observed') return 1000;
  if (state === 'no-network') return 10000;
  if (state === 'incomplete-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { linkCount: 0, meshCount: 0, unknownMeshCount: 0, meshChangeCount: 0 };
}

export function mergeNetworkObservationMeshEvidenceReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_ID,
    libraryVersion: NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    linkCount: last.linkCount,
    meshCount: last.meshCount,
    unknownMeshCount: last.unknownMeshCount,
    meshChangeCount: last.meshChangeCount,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noNetworkCount: validated.reduce((sum, report) => sum + report.noNetworkCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    meshChangeSampleCount: validated.reduce((sum, report) => sum + report.meshChangeSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildNetworkObservationMeshEvidencePlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0 ? 0
      : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Mesh-evidence library clock must return a number');
  return timestamp;
}

export function buildNetworkObservationMeshEvidenceEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Mesh-evidence library trigger is required');
  }
  return Object.freeze({
    library: NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_ID,
    libraryVersion: NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createNetworkObservationMeshEvidenceLibrary() {
  return Object.freeze({
    id: NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_ID,
    version: NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_VERSION,
    merge: mergeNetworkObservationMeshEvidenceReports,
    plan: buildNetworkObservationMeshEvidencePlan,
    envelope: buildNetworkObservationMeshEvidenceEnvelope
  });
}
