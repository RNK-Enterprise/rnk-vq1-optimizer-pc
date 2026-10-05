import {
  GPU_UTILIZATION_BURST_LIBRARY_ID,
  GPU_UTILIZATION_BURST_LIBRARY_VERSION,
  buildGpuUtilizationBurstEnvelope,
  buildGpuUtilizationBurstPlan,
  createGpuUtilizationBurstLibrary,
  mergeGpuUtilizationBurstReports
} from '../pc/engines/gpu-utilization/turbos/utilization-burst/library.js';

function report(overrides = {}) {
  return {
    turbo: 'gpu-utilization.utilization-burst',
    state: 'normal-utilization',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    burstCount: 0,
    normalCount: 4,
    confidence: 1,
    ...overrides
  };
}

describe('GPU utilization-burst library', () => {
  test('publishes identity and merges utilization evidence', () => {
    const merged = mergeGpuUtilizationBurstReports([
      report({ sampleCount: 2, observedCount: 2, burstCount: 1, normalCount: 1 }),
      report({ state: 'sustained-burst', sampleCount: 6, observedCount: 5,
        unknownCount: 1, burstCount: 3, normalCount: 2, confidence: 0.8333 })
    ]);
    expect(GPU_UTILIZATION_BURST_LIBRARY_ID).toBe('gpu-utilization.utilization-burst.library');
    expect(GPU_UTILIZATION_BURST_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'sustained-burst',
      sampleCount: 8, observedCount: 7, unknownCount: 1, burstCount: 4,
      normalCount: 3, confidence: 0.875,
      recommendations: ['protect-foreground-or-services', 'hold-unapproved-gpu-policy'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeGpuUtilizationBurstReports([])).toMatchObject({ state: 'insufficient-data',
      reportCount: 0, confidence: 0, recommendations: ['collect-more-gpu-utilization-samples'] });
    expect(mergeGpuUtilizationBurstReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, normalCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-observation', confidence: 0, recommendations: ['request-gpu-utilization-observation'] });
    expect(mergeGpuUtilizationBurstReports([report({ state: 'invalid-utilization-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-utilization-evidence', recommendations: ['review-gpu-utilization-sensor-range'] });
    expect(mergeGpuUtilizationBurstReports([report({ state: 'burst-observed', burstCount: 1 })]))
      .toMatchObject({ state: 'burst-observed', recommendations: ['observe-next-gpu-sample'] });
    expect(mergeGpuUtilizationBurstReports([report({ state: 'normal-utilization' })]))
      .toMatchObject({ state: 'normal-utilization', recommendations: ['no-change'] });
    expect(mergeGpuUtilizationBurstReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, normalCount: 0, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeGpuUtilizationBurstReports([
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0, unknownCount: 0, normalCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, normalCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies precedence and builds every state plan', () => {
    expect(mergeGpuUtilizationBurstReports([
      report({ state: 'sustained-burst', burstCount: 1 }),
      report({ state: 'invalid-utilization-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-utilization-evidence' });
    const states = [
      ['invalid-utilization-evidence', 'sensor-review', 500],
      ['sustained-burst', 'gpu-protection', 750],
      ['burst-observed', 'burst-observation', 1000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['normal-utilization', 'normal-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildGpuUtilizationBurstPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildGpuUtilizationBurstPlan(report({ state: 'normal-utilization' }), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildGpuUtilizationBurstPlan(report({ state: 'normal-utilization', sampleCount: 0,
      observedCount: 0, unknownCount: 0, normalCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildGpuUtilizationBurstEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: GPU_UTILIZATION_BURST_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuUtilizationBurstLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(GPU_UTILIZATION_BURST_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, normalCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeGpuUtilizationBurstReports(null)).toThrow('reports must be an array');
    expect(() => mergeGpuUtilizationBurstReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeGpuUtilizationBurstReports([null])).toThrow('report must be an object');
    expect(() => mergeGpuUtilizationBurstReports([[]])).toThrow('report must be an object');
    expect(() => mergeGpuUtilizationBurstReports([report({ turbo: 'other' })]))
      .toThrow('requires a utilization-burst turbo report');
    expect(() => mergeGpuUtilizationBurstReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeGpuUtilizationBurstReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'burstCount', 'normalCount']) {
      expect(() => mergeGpuUtilizationBurstReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeGpuUtilizationBurstReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeGpuUtilizationBurstReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildGpuUtilizationBurstEnvelope(report())).toThrow('trigger is required');
    expect(() => buildGpuUtilizationBurstEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildGpuUtilizationBurstEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildGpuUtilizationBurstEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
