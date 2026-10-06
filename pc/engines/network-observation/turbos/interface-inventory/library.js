/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated interface-inventory library. It validates, aggregates, and plans
 * interface identity reports without importing the turbo or changing state.
 */

export const NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_ID = 'network-observation.interface-inventory.library';
export const NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'interface-drift-sustained', 'interface-drift-observed', 'stable-interface-inventory',
  'no-network', 'incomplete-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Interface-inventory library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Interface-inventory library report must be an object');
  if (report.turbo !== 'network-observation.interface-inventory') {
    throw new Error('Interface-inventory library requires an interface-inventory turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Interface-inventory library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Interface-inventory library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Interface-inventory library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Interface-inventory library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noNetworkCount', 'no-network count'], ['comparisonCount', 'comparison count'],
    ['inventoryChangeSampleCount', 'inventory-change sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.linkCount) || report.linkCount < 0 || report.linkCount > 4096) {
    throw new RangeError('Interface-inventory library linkCount must be from 0 to 4096');
  }
  for (const [field, label] of [['addedCount', 'added count'], ['removedCount', 'removed count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.linkCount) {
      throw new RangeError(`Interface-inventory library ${label} must fit inside linkCount`);
    }
  }
  if (!Number.isInteger(report.inventoryChangeCount) || report.inventoryChangeCount < 0
    || report.inventoryChangeCount > 8192) {
    throw new RangeError('Interface-inventory library inventoryChangeCount must be from 0 to 8192');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Interface-inventory library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Interface-inventory library reports must be an array');
  if (reports.length > 64) throw new RangeError('Interface-inventory library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-network')) return 'no-network';
  if (reports.some((report) => report.state === 'incomplete-evidence')) return 'incomplete-evidence';
  if (reports.some((report) => report.state === 'interface-drift-sustained')) return 'interface-drift-sustained';
  if (reports.some((report) => report.state === 'interface-drift-observed')) return 'interface-drift-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-interface-inventory';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-interface-inventory']);
  if (state === 'no-network') return Object.freeze(['no-network-interface-review']);
  if (state === 'incomplete-evidence') return Object.freeze(['request-interface-identity-evidence']);
  if (state === 'interface-drift-sustained') return Object.freeze(['review-interface-inventory-drift-without-network-mutation']);
  if (state === 'interface-drift-observed') return Object.freeze(['observe-interface-inventory-stability']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'interface-drift-sustained') return 'interface-inventory-review';
  if (state === 'interface-drift-observed') return 'interface-inventory-observation';
  if (state === 'no-network') return 'no-network-observation';
  if (state === 'incomplete-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-interface-observation';
}

function intervalFor(state, environment) {
  if (state === 'interface-drift-sustained') return 750;
  if (state === 'interface-drift-observed') return 1000;
  if (state === 'no-network') return 10000;
  if (state === 'incomplete-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { linkCount: 0, addedCount: 0, removedCount: 0, inventoryChangeCount: 0 };
}

export function mergeNetworkObservationInterfaceInventoryReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_ID,
    libraryVersion: NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    linkCount: last.linkCount,
    addedCount: last.addedCount,
    removedCount: last.removedCount,
    inventoryChangeCount: last.inventoryChangeCount,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noNetworkCount: validated.reduce((sum, report) => sum + report.noNetworkCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    inventoryChangeSampleCount: validated.reduce((sum, report) => sum + report.inventoryChangeSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildNetworkObservationInterfaceInventoryPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Interface-inventory library clock must return a number');
  return timestamp;
}

export function buildNetworkObservationInterfaceInventoryEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Interface-inventory library trigger is required');
  }
  return Object.freeze({
    library: NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_ID,
    libraryVersion: NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createNetworkObservationInterfaceInventoryLibrary() {
  return Object.freeze({
    id: NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_ID,
    version: NETWORK_OBSERVATION_INTERFACE_INVENTORY_LIBRARY_VERSION,
    merge: mergeNetworkObservationInterfaceInventoryReports,
    plan: buildNetworkObservationInterfaceInventoryPlan,
    envelope: buildNetworkObservationInterfaceInventoryEnvelope
  });
}
