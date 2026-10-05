import {
  GPU_VRAM_PRESSURE_LIBRARY_ID,
  GPU_VRAM_PRESSURE_LIBRARY_VERSION,
  buildGpuVramPressureEnvelope,
  buildGpuVramPressurePlan,
  createGpuVramPressureLibrary,
  mergeGpuVramPressureReports
} from '../pc/engines/gpu-utilization/turbos/vram-pressure/library.js';

function report(overrides = {}) {
  return {
    turbo: 'gpu-utilization.vram-pressure',
    state: 'normal-vram-pressure',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    noVramCount: 0,
    criticalCount: 0,
    elevatedCount: 0,
    confidence: 1,
    ...overrides
  };
}

describe('GPU VRAM-pressure library', () => {
  test('publishes identity and merges VRAM evidence', () => {
    const merged = mergeGpuVramPressureReports([
      report({ sampleCount: 2, observedCount: 2, criticalCount: 1 }),
      report({ state: 'sustained-critical-vram', sampleCount: 6, observedCount: 5,
        unknownCount: 1, criticalCount: 3, elevatedCount: 1, confidence: 0.8333 })
    ]);
    expect(GPU_VRAM_PRESSURE_LIBRARY_ID).toBe('gpu-utilization.vram-pressure.library');
    expect(GPU_VRAM_PRESSURE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'sustained-critical-vram',
      sampleCount: 8, observedCount: 7, unknownCount: 1, criticalCount: 4,
      elevatedCount: 1, confidence: 0.875,
      recommendations: ['hold-unapproved-gpu-policy', 'protect-vram-headroom'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeGpuVramPressureReports([])).toMatchObject({ state: 'insufficient-data',
      reportCount: 0, confidence: 0, recommendations: ['collect-more-gpu-vram-samples'] });
    expect(mergeGpuVramPressureReports([report({ state: 'no-vram', sampleCount: 0,
      observedCount: 0, unknownCount: 0, noVramCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-vram', confidence: 0, recommendations: ['no-change', 'keep-vram-controls-disabled'] });
    expect(mergeGpuVramPressureReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, confidence: 0 })])).toMatchObject({ state: 'no-observation',
        recommendations: ['request-gpu-vram-observation'] });
    expect(mergeGpuVramPressureReports([report({ state: 'invalid-vram-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-vram-evidence', recommendations: ['review-gpu-vram-sensor-range'] });
    expect(mergeGpuVramPressureReports([report({ state: 'sustained-elevated-vram', elevatedCount: 2 })]))
      .toMatchObject({ state: 'sustained-elevated-vram', recommendations: ['observe-next-vram-sample', 'review-vram-headroom'] });
    expect(mergeGpuVramPressureReports([report({ state: 'normal-vram-pressure' })]))
      .toMatchObject({ state: 'normal-vram-pressure', recommendations: ['no-change'] });
    expect(mergeGpuVramPressureReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeGpuVramPressureReports([
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0, unknownCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies precedence and builds every state plan', () => {
    expect(mergeGpuVramPressureReports([
      report({ state: 'sustained-critical-vram', criticalCount: 1 }),
      report({ state: 'invalid-vram-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-vram-evidence' });
    const states = [
      ['invalid-vram-evidence', 'sensor-review', 500],
      ['sustained-critical-vram', 'vram-protection', 750],
      ['sustained-elevated-vram', 'vram-observation', 1000],
      ['no-vram', 'no-vram-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['normal-vram-pressure', 'normal-vram-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildGpuVramPressurePlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildGpuVramPressurePlan(report({ state: 'normal-vram-pressure' }), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildGpuVramPressurePlan(report({ state: 'normal-vram-pressure', sampleCount: 0,
      observedCount: 0, unknownCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildGpuVramPressureEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: GPU_VRAM_PRESSURE_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuVramPressureLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(GPU_VRAM_PRESSURE_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeGpuVramPressureReports(null)).toThrow('reports must be an array');
    expect(() => mergeGpuVramPressureReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeGpuVramPressureReports([null])).toThrow('report must be an object');
    expect(() => mergeGpuVramPressureReports([[]])).toThrow('report must be an object');
    expect(() => mergeGpuVramPressureReports([report({ turbo: 'other' })]))
      .toThrow('requires a vram-pressure turbo report');
    expect(() => mergeGpuVramPressureReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeGpuVramPressureReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'noVramCount', 'criticalCount', 'elevatedCount']) {
      expect(() => mergeGpuVramPressureReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeGpuVramPressureReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeGpuVramPressureReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildGpuVramPressureEnvelope(report())).toThrow('trigger is required');
    expect(() => buildGpuVramPressureEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildGpuVramPressureEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildGpuVramPressureEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
