/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * GPU-policy library. It classifies vendor and driver evidence for documented
 * review only; it never installs, loads, or changes a driver or GPU policy.
 */

export const GPU_POLICY_LIBRARY_ID = 'gpu-policy-library';
export const GPU_POLICY_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const KNOWN_VENDORS = Object.freeze(['nvidia', 'amd', 'ati', 'intel']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function vendorEvidence(vendor) {
  if (vendor === null) return 'unknown';
  const normalized = vendor.toLowerCase();
  if (KNOWN_VENDORS.includes(normalized)) return 'documented';
  if (normalized.includes('nvidia') || normalized.includes('amd')
    || normalized.includes('ati') || normalized.includes('intel')) return 'documented';
  return 'vendor-specific';
}

function driverEvidence(driver) {
  if (driver === null) return 'unknown';
  const normalized = driver.toLowerCase();
  if (normalized.includes('nouveau') || normalized.includes('amdgpu')
    || normalized.includes('i915') || normalized.includes('nvidia')) return 'documented';
  return 'vendor-specific';
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('GPU-policy library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('GPU-policy library requires normalized system facts');
  }
  if (!Array.isArray(facts.gpus)) throw new TypeError('GPU-policy library requires a GPU list');
  return facts;
}

function recommendations(environment, count, vendorSpecific, unknownEvidence) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-gpu-policy-review']);
  if (vendorSpecific > 0) return Object.freeze(['review-vendor-documentation-without-change']);
  if (unknownEvidence > 0) return Object.freeze(['request-gpu-policy-observation']);
  return Object.freeze(['no-change']);
}

export function classifyGpuPolicy(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const gpus = source.gpus.filter(isRecord).map((gpu) => {
    const vendor = text(gpu.vendor);
    const driver = text(gpu.driver);
    return Object.freeze({
      vendor,
      driver,
      vendorEvidence: vendorEvidence(vendor),
      driverEvidence: driverEvidence(driver)
    });
  });
  const vendorSpecific = gpus.filter((gpu) => gpu.vendorEvidence === 'vendor-specific'
    || gpu.driverEvidence === 'vendor-specific').length;
  const unknownEvidence = gpus.filter((gpu) => gpu.vendorEvidence === 'unknown'
    || gpu.driverEvidence === 'unknown').length;
  return Object.freeze({
    library: GPU_POLICY_LIBRARY_ID,
    libraryVersion: GPU_POLICY_LIBRARY_VERSION,
    environment,
    gpuCount: gpus.length,
    vendors: Object.freeze(gpus.map((gpu) => gpu.vendor).filter(Boolean)),
    drivers: Object.freeze(gpus.map((gpu) => gpu.driver).filter(Boolean)),
    vendorEvidence: Object.freeze(gpus.map((gpu) => gpu.vendorEvidence)),
    driverEvidence: Object.freeze(gpus.map((gpu) => gpu.driverEvidence)),
    vendorSpecific,
    unknownEvidence,
    recommendations: recommendations(environment, gpus.length, vendorSpecific, unknownEvidence)
  });
}

export function compareGpuPolicy(previous, current) {
  const before = classifyGpuPolicy(previous);
  const after = classifyGpuPolicy(current);
  const vendorEvidenceChanged = before.vendorSpecific !== after.vendorSpecific;
  const unknownEvidenceChanged = before.unknownEvidence !== after.unknownEvidence;
  const gpuCountChanged = before.gpuCount !== after.gpuCount;
  return Object.freeze({
    changed: vendorEvidenceChanged || unknownEvidenceChanged || gpuCountChanged,
    vendorEvidenceChanged,
    unknownEvidenceChanged,
    gpuCountChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU-policy library clock must return a number');
  return timestamp;
}

export function buildGpuPolicyEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('GPU-policy library trigger is required');
  }
  return Object.freeze({
    library: GPU_POLICY_LIBRARY_ID,
    libraryVersion: GPU_POLICY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyGpuPolicy(facts)
  });
}

export function createGpuPolicyLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('GPU-policy library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: GPU_POLICY_LIBRARY_ID,
    version: GPU_POLICY_LIBRARY_VERSION,
    classify: classifyGpuPolicy,
    compare: compareGpuPolicy,
    envelope: (facts, envelopeOptions = {}) => buildGpuPolicyEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
