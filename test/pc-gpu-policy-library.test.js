import {
  GPU_POLICY_LIBRARY_ID,
  GPU_POLICY_LIBRARY_VERSION,
  buildGpuPolicyEnvelope,
  classifyGpuPolicy,
  compareGpuPolicy,
  createGpuPolicyLibrary
} from '../pc/engines/gpu-policy/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    gpus: [{ vendor: 'NVIDIA', driver: 'nvidia 610' }],
    ...overrides
  };
}

describe('GPU-policy library', () => {
  test('classifies documented and vendor-specific evidence', () => {
    expect(classifyGpuPolicy(facts())).toMatchObject({
      library: GPU_POLICY_LIBRARY_ID,
      libraryVersion: GPU_POLICY_LIBRARY_VERSION,
      gpuCount: 1, vendors: ['NVIDIA'], drivers: ['nvidia 610'],
      vendorEvidence: ['documented'], driverEvidence: ['documented'],
      vendorSpecific: 0, unknownEvidence: 0, recommendations: ['no-change']
    });
    expect(classifyGpuPolicy(facts({ gpus: [
      { vendor: 'NVIDIA Corporation', driver: 'custom-driver' }
    ] })).vendorEvidence).toEqual(['documented']);
    expect(classifyGpuPolicy(facts({ gpus: [
      { vendor: 'CustomVendor', driver: 'custom-driver' },
      { vendor: 'amd', driver: 'amdgpu' },
      { vendor: 'intel', driver: 'i915' }
    ] }))).toMatchObject({
      gpuCount: 3, vendorSpecific: 1, unknownEvidence: 0,
      recommendations: ['review-vendor-documentation-without-change']
    });
  });

  test('preserves no-GPU, unknown, and incomplete evidence states', () => {
    expect(classifyGpuPolicy(facts({ gpus: [] })).recommendations)
      .toEqual(['no-gpu-policy-review']);
    expect(classifyGpuPolicy(facts({ gpus: [{ vendor: null, driver: null }] }))).toMatchObject({
      gpuCount: 1, vendorEvidence: ['unknown'], driverEvidence: ['unknown'],
      vendorSpecific: 0, unknownEvidence: 1, recommendations: ['request-gpu-policy-observation']
    });
    expect(classifyGpuPolicy(facts({ environment: 'other', gpus: [] })).recommendations)
      .toEqual(['request-environment-profile']);
    expect(classifyGpuPolicy(facts({ gpus: [{ vendor: 'NVIDIA', driver: 'nouveau' }] })))
      .toMatchObject({ driverEvidence: ['documented'] });
  });

  test('compares policy evidence and builds immutable local facades', () => {
    expect(compareGpuPolicy(facts(), facts({ gpus: [
      { vendor: 'CustomVendor', driver: 'custom-driver' }
    ] }))).toMatchObject({ changed: true, vendorEvidenceChanged: true, unknownEvidenceChanged: false, gpuCountChanged: false });
    expect(compareGpuPolicy(facts(), facts({ gpus: [
      { vendor: null, driver: null }
    ] }))).toMatchObject({ changed: true, vendorEvidenceChanged: false, unknownEvidenceChanged: true, gpuCountChanged: false });
    expect(compareGpuPolicy(facts(), facts({ gpus: [] }))).toMatchObject({ changed: true, gpuCountChanged: true });
    expect(compareGpuPolicy(facts(), facts())).toMatchObject({ changed: false });
    const envelope = buildGpuPolicyEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuPolicyLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyGpuPolicy(null)).toThrow('facts must be an object');
    expect(() => classifyGpuPolicy({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyGpuPolicy({ ...facts(), gpus: null })).toThrow('requires a GPU list');
    expect(() => buildGpuPolicyEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildGpuPolicyEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createGpuPolicyLibrary(null)).toThrow('options must be an object');
    expect(() => createGpuPolicyLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
