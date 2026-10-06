/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated vendor-mix library. It validates, aggregates, and plans adapter
 * composition reports without importing the turbo or changing GPU policy.
 */

export const GPU_VENDOR_MIX_LIBRARY_ID = 'gpu-policy.vendor-mix.library';
export const GPU_VENDOR_MIX_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'sustained-mixed-vendor-layout',
  'mixed-vendor-observed',
  'homogeneous-vendor-layout',
  'vendor-specific-layout',
  'incomplete-vendor-evidence',
  'no-gpu',
  'no-observation',
  'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value, lower, upper) {
  return Number.isFinite(value) && value >= lower && value <= upper;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Vendor-mix library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Vendor-mix library report must be an object');
  if (report.turbo !== 'gpu-policy.vendor-mix') {
    throw new Error('Vendor-mix library requires a vendor-mix turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Vendor-mix library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Vendor-mix library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['mixedCount', 'mixed count'],
    ['homogeneousCount', 'homogeneous count'],
    ['vendorSpecificCount', 'vendor-specific count'],
    ['incompleteCount', 'incomplete count'],
    ['noGpuCount', 'no-GPU count']
  ]) requireCount(report, field, label);
  if (!Array.isArray(report.vendors)) throw new TypeError('Vendor-mix library report vendors must be an array');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Vendor-mix library persistenceThreshold must be from 1 to 64');
  }
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Vendor-mix library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Vendor-mix library reports must be an array');
  if (reports.length > 64) throw new RangeError('Vendor-mix library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'incomplete-vendor-evidence')) {
    return 'incomplete-vendor-evidence';
  }
  if (reports.some((report) => report.state === 'vendor-specific-layout')) {
    return 'vendor-specific-layout';
  }
  if (reports.some((report) => report.state === 'sustained-mixed-vendor-layout')) {
    return 'sustained-mixed-vendor-layout';
  }
  if (reports.some((report) => report.state === 'mixed-vendor-observed')) return 'mixed-vendor-observed';
  if (reports.every((report) => report.state === 'no-gpu')) return 'no-gpu';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'homogeneous-vendor-layout')
    ? 'homogeneous-vendor-layout' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'sustained-mixed-vendor-layout') {
    return Object.freeze(['review-gpu-workload-distribution', 'hold-unapproved-gpu-policy']);
  }
  if (state === 'mixed-vendor-observed') return Object.freeze(['observe-next-gpu-vendor-sample']);
  if (state === 'vendor-specific-layout') {
    return Object.freeze(['review-documented-gpu-vendor-controls']);
  }
  if (state === 'incomplete-vendor-evidence') return Object.freeze(['request-complete-gpu-vendor-evidence']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-gpu-vendor-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-gpu-vendor-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'sustained-mixed-vendor-layout') return 'mixed-vendor-review';
  if (state === 'mixed-vendor-observed') return 'vendor-mix-observation';
  if (state === 'vendor-specific-layout') return 'vendor-documentation-review';
  if (state === 'incomplete-vendor-evidence') return 'evidence-bootstrap';
  if (state === 'no-gpu') return 'no-gpu-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'homogeneous-layout-observation';
}

function intervalFor(state, environment) {
  if (state === 'sustained-mixed-vendor-layout') return 750;
  if (state === 'mixed-vendor-observed') return 1000;
  if (state === 'vendor-specific-layout') return 1250;
  if (state === 'incomplete-vendor-evidence') return 1500;
  if (state === 'no-gpu') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeGpuVendorMixReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: GPU_VENDOR_MIX_LIBRARY_ID,
    libraryVersion: GPU_VENDOR_MIX_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    mixedCount: validated.reduce((sum, report) => sum + report.mixedCount, 0),
    homogeneousCount: validated.reduce((sum, report) => sum + report.homogeneousCount, 0),
    vendorSpecificCount: validated.reduce((sum, report) => sum + report.vendorSpecificCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noGpuCount: validated.reduce((sum, report) => sum + report.noGpuCount, 0),
    vendors: Object.freeze([...new Set(validated.flatMap((report) => report.vendors))].sort()),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildGpuVendorMixPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: GPU_VENDOR_MIX_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0
      ? 0 : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Vendor-mix library clock must return a number');
  return timestamp;
}

export function buildGpuVendorMixEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Vendor-mix library trigger is required');
  }
  return Object.freeze({
    library: GPU_VENDOR_MIX_LIBRARY_ID,
    libraryVersion: GPU_VENDOR_MIX_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createGpuVendorMixLibrary() {
  return Object.freeze({
    id: GPU_VENDOR_MIX_LIBRARY_ID,
    version: GPU_VENDOR_MIX_LIBRARY_VERSION,
    merge: mergeGpuVendorMixReports,
    plan: buildGpuVendorMixPlan,
    envelope: buildGpuVendorMixEnvelope
  });
}
