import {
  GPU_VENDOR_MIX_LIBRARY_ID,
  GPU_VENDOR_MIX_LIBRARY_VERSION,
  buildGpuVendorMixEnvelope,
  buildGpuVendorMixPlan,
  createGpuVendorMixLibrary,
  mergeGpuVendorMixReports
} from '../pc/engines/gpu-policy/turbos/vendor-mix/library.js';

function report(overrides = {}) {
  return {
    turbo: 'gpu-policy.vendor-mix',
    state: 'homogeneous-vendor-layout',
    sampleCount: 4,
    observedCount: 4,
    mixedCount: 0,
    homogeneousCount: 4,
    vendorSpecificCount: 0,
    incompleteCount: 0,
    noGpuCount: 0,
    vendors: ['nvidia'],
    persistenceThreshold: 2,
    confidence: 1,
    ...overrides
  };
}

describe('gpu-policy vendor-mix library', () => {
  test('publishes identity and merges vendor composition evidence', () => {
    const merged = mergeGpuVendorMixReports([
      report({ sampleCount: 2, observedCount: 2, mixedCount: 1, homogeneousCount: 1,
        vendors: ['nvidia', 'amd'] }),
      report({ state: 'sustained-mixed-vendor-layout', sampleCount: 6, observedCount: 5,
        mixedCount: 3, homogeneousCount: 2, vendors: ['amd'], confidence: 0.8333 })
    ]);

    expect(GPU_VENDOR_MIX_LIBRARY_ID).toBe('gpu-policy.vendor-mix.library');
    expect(GPU_VENDOR_MIX_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'sustained-mixed-vendor-layout',
      sampleCount: 8,
      observedCount: 7,
      mixedCount: 4,
      homogeneousCount: 3,
      vendors: ['amd', 'nvidia'],
      confidence: 0.875,
      recommendations: ['review-gpu-workload-distribution', 'hold-unapproved-gpu-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.vendors)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeGpuVendorMixReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      recommendations: ['collect-more-gpu-vendor-samples']
    });
    expect(mergeGpuVendorMixReports([report({ state: 'no-gpu', sampleCount: 0,
      observedCount: 0, homogeneousCount: 0, vendors: [], confidence: 0 })]))
      .toMatchObject({ state: 'no-gpu', confidence: 0,
        recommendations: ['no-change', 'keep-gpu-controls-disabled'] });
    expect(mergeGpuVendorMixReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, homogeneousCount: 0, vendors: [], confidence: 0 })]))
      .toMatchObject({ state: 'no-observation', recommendations: ['request-gpu-vendor-observation'] });
    expect(mergeGpuVendorMixReports([report({ state: 'incomplete-vendor-evidence', incompleteCount: 1 })]))
      .toMatchObject({ state: 'incomplete-vendor-evidence', recommendations: ['request-complete-gpu-vendor-evidence'] });
    expect(mergeGpuVendorMixReports([report({ state: 'vendor-specific-layout', vendorSpecificCount: 1 })]))
      .toMatchObject({ state: 'vendor-specific-layout', recommendations: ['review-documented-gpu-vendor-controls'] });
    expect(mergeGpuVendorMixReports([report({ state: 'mixed-vendor-observed', mixedCount: 1 })]))
      .toMatchObject({ state: 'mixed-vendor-observed', recommendations: ['observe-next-gpu-vendor-sample'] });
    expect(mergeGpuVendorMixReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, homogeneousCount: 0, vendors: [], confidence: 0 })]))
      .toMatchObject({ state: 'insufficient-data' });
    expect(mergeGpuVendorMixReports([report()])).toMatchObject({
      state: 'homogeneous-vendor-layout', recommendations: ['no-change']
    });
    expect(mergeGpuVendorMixReports([
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0,
        homogeneousCount: 0, vendors: [], confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0,
        homogeneousCount: 0, vendors: [], confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeGpuVendorMixReports([
      report({ state: 'sustained-mixed-vendor-layout', mixedCount: 1 }),
      report({ state: 'incomplete-vendor-evidence', incompleteCount: 1 })
    ])).toMatchObject({ state: 'incomplete-vendor-evidence' });
    const states = [
      ['sustained-mixed-vendor-layout', 'mixed-vendor-review', 750],
      ['mixed-vendor-observed', 'vendor-mix-observation', 1000],
      ['homogeneous-vendor-layout', 'homogeneous-layout-observation', 5000],
      ['vendor-specific-layout', 'vendor-documentation-review', 1250],
      ['incomplete-vendor-evidence', 'evidence-bootstrap', 1500],
      ['no-gpu', 'no-gpu-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildGpuVendorMixPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildGpuVendorMixPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildGpuVendorMixPlan(report({ sampleCount: 0, observedCount: 0,
      homogeneousCount: 0, vendors: [], confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildGpuVendorMixEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: GPU_VENDOR_MIX_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuVendorMixLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(GPU_VENDOR_MIX_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      homogeneousCount: 0, vendors: [], confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeGpuVendorMixReports(null)).toThrow('reports must be an array');
    expect(() => mergeGpuVendorMixReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeGpuVendorMixReports([null])).toThrow('report must be an object');
    expect(() => mergeGpuVendorMixReports([[]])).toThrow('report must be an object');
    expect(() => mergeGpuVendorMixReports([report({ turbo: 'other' })]))
      .toThrow('requires a vendor-mix turbo report');
    expect(() => mergeGpuVendorMixReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeGpuVendorMixReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'mixedCount', 'homogeneousCount',
      'vendorSpecificCount', 'incompleteCount', 'noGpuCount']) {
      expect(() => mergeGpuVendorMixReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeGpuVendorMixReports([report({ vendors: null })]))
      .toThrow('vendors must be an array');
    expect(() => mergeGpuVendorMixReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeGpuVendorMixReports([report({ persistenceThreshold: 65 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeGpuVendorMixReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeGpuVendorMixReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildGpuVendorMixEnvelope(report())).toThrow('trigger is required');
    expect(() => buildGpuVendorMixEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildGpuVendorMixEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildGpuVendorMixEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
