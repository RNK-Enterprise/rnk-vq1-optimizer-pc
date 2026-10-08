/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated inventory-drift library. It validates, aggregates, and plans
 * driver identity-set reports without importing the turbo or changing data.
 */

export const DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_ID = 'driver-capability.inventory-drift.library';
export const DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'inventory-drift-sustained', 'inventory-drift-observed', 'stable-inventory',
  'no-drivers', 'incomplete-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Inventory-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Inventory-drift library report must be an object');
  if (report.turbo !== 'driver-capability.inventory-drift') {
    throw new Error('Inventory-drift library requires an inventory-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Inventory-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Inventory-drift library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Inventory-drift library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Inventory-drift library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noDriverCount', 'no-driver count'], ['comparisonCount', 'comparison count'],
    ['inventoryChangeSampleCount', 'inventory-change sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.driverCount) || report.driverCount < 0 || report.driverCount > 4096) {
    throw new RangeError('Inventory-drift library driverCount must be from 0 to 4096');
  }
  for (const [field, label] of [['addedCount', 'added count'], ['removedCount', 'removed count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.driverCount) {
      throw new RangeError(`Inventory-drift library ${label} must fit inside driverCount`);
    }
  }
  if (!Number.isInteger(report.inventoryChangeCount) || report.inventoryChangeCount < 0
    || report.inventoryChangeCount > 8192) {
    throw new RangeError('Inventory-drift library inventoryChangeCount must be from 0 to 8192');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Inventory-drift library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Inventory-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Inventory-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-drivers')) return 'no-drivers';
  if (reports.some((report) => report.state === 'incomplete-evidence')) return 'incomplete-evidence';
  if (reports.some((report) => report.state === 'inventory-drift-sustained')) return 'inventory-drift-sustained';
  if (reports.some((report) => report.state === 'inventory-drift-observed')) return 'inventory-drift-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-inventory';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-driver-inventory']);
  if (state === 'no-drivers') return Object.freeze(['no-driver-inventory-review']);
  if (state === 'incomplete-evidence') return Object.freeze(['request-driver-inventory-evidence']);
  if (state === 'inventory-drift-sustained') return Object.freeze(['review-driver-inventory-drift-without-change']);
  if (state === 'inventory-drift-observed') return Object.freeze(['observe-driver-inventory-stability']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'inventory-drift-sustained') return 'driver-inventory-review';
  if (state === 'inventory-drift-observed') return 'driver-inventory-observation';
  if (state === 'no-drivers') return 'no-driver-observation';
  if (state === 'incomplete-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-driver-inventory-observation';
}

function intervalFor(state, environment) {
  if (state === 'inventory-drift-sustained') return 750;
  if (state === 'inventory-drift-observed') return 1000;
  if (state === 'no-drivers') return 10000;
  if (state === 'incomplete-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { driverCount: 0, addedCount: 0, removedCount: 0, inventoryChangeCount: 0 };
}

export function mergeDriverCapabilityInventoryDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_ID,
    libraryVersion: DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    driverCount: last.driverCount,
    addedCount: last.addedCount,
    removedCount: last.removedCount,
    inventoryChangeCount: last.inventoryChangeCount,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDriverCount: validated.reduce((sum, report) => sum + report.noDriverCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    inventoryChangeSampleCount: validated.reduce((sum, report) => sum + report.inventoryChangeSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildDriverCapabilityInventoryDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Inventory-drift library clock must return a number');
  return timestamp;
}

export function buildDriverCapabilityInventoryDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Inventory-drift library trigger is required');
  }
  return Object.freeze({
    library: DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_ID,
    libraryVersion: DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createDriverCapabilityInventoryDriftLibrary() {
  return Object.freeze({
    id: DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_ID,
    version: DRIVER_CAPABILITY_INVENTORY_DRIFT_LIBRARY_VERSION,
    merge: mergeDriverCapabilityInventoryDriftReports,
    plan: buildDriverCapabilityInventoryDriftPlan,
    envelope: buildDriverCapabilityInventoryDriftEnvelope
  });
}
