import {
  GPU_THERMAL_MARGIN_LIBRARY_ID,
  GPU_THERMAL_MARGIN_LIBRARY_VERSION,
  buildGpuThermalMarginEnvelope,
  buildGpuThermalMarginPlan,
  createGpuThermalMarginLibrary,
  mergeGpuThermalMarginReports
} from '../pc/engines/gpu-utilization/turbos/thermal-margin/library.js';

function report(overrides = {}) {
  return {
    turbo: 'gpu-utilization.thermal-margin',
    state: 'normal-thermal-margin',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    criticalCount: 0,
    elevatedCount: 0,
    confidence: 1,
    ...overrides
  };
}

describe('GPU thermal-margin library', () => {
  test('publishes identity and merges thermal evidence', () => {
    const merged = mergeGpuThermalMarginReports([
      report({ sampleCount: 2, observedCount: 2, criticalCount: 1 }),
      report({ state: 'sustained-critical-thermal', sampleCount: 6, observedCount: 5,
        unknownCount: 1, criticalCount: 3, elevatedCount: 1, confidence: 0.8333 })
    ]);
    expect(GPU_THERMAL_MARGIN_LIBRARY_ID).toBe('gpu-utilization.thermal-margin.library');
    expect(GPU_THERMAL_MARGIN_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'sustained-critical-thermal',
      sampleCount: 8, observedCount: 7, unknownCount: 1, criticalCount: 4,
      elevatedCount: 1, confidence: 0.875,
      recommendations: ['hold-unapproved-gpu-policy', 'protect-thermal-headroom'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeGpuThermalMarginReports([])).toMatchObject({ state: 'insufficient-data',
      reportCount: 0, confidence: 0, recommendations: ['collect-more-gpu-thermal-samples'] });
    expect(mergeGpuThermalMarginReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, confidence: 0 })])).toMatchObject({ state: 'no-observation',
        confidence: 0, recommendations: ['request-gpu-thermal-observation'] });
    expect(mergeGpuThermalMarginReports([report({ state: 'invalid-thermal-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-thermal-evidence', recommendations: ['review-gpu-temperature-sensor-range'] });
    expect(mergeGpuThermalMarginReports([report({ state: 'sustained-elevated-thermal', elevatedCount: 2 })]))
      .toMatchObject({ state: 'sustained-elevated-thermal', recommendations: ['observe-next-thermal-sample', 'review-thermal-headroom'] });
    expect(mergeGpuThermalMarginReports([report({ state: 'normal-thermal-margin' })]))
      .toMatchObject({ state: 'normal-thermal-margin', recommendations: ['no-change'] });
    expect(mergeGpuThermalMarginReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeGpuThermalMarginReports([
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0, unknownCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies precedence and builds every state plan', () => {
    expect(mergeGpuThermalMarginReports([
      report({ state: 'sustained-critical-thermal', criticalCount: 1 }),
      report({ state: 'invalid-thermal-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-thermal-evidence' });
    const states = [
      ['invalid-thermal-evidence', 'sensor-review', 500],
      ['sustained-critical-thermal', 'thermal-protection', 750],
      ['sustained-elevated-thermal', 'thermal-observation', 1000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['normal-thermal-margin', 'normal-thermal-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildGpuThermalMarginPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildGpuThermalMarginPlan(report({ state: 'normal-thermal-margin' }), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildGpuThermalMarginPlan(report({ state: 'normal-thermal-margin', sampleCount: 0,
      observedCount: 0, unknownCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildGpuThermalMarginEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: GPU_THERMAL_MARGIN_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuThermalMarginLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(GPU_THERMAL_MARGIN_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeGpuThermalMarginReports(null)).toThrow('reports must be an array');
    expect(() => mergeGpuThermalMarginReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeGpuThermalMarginReports([null])).toThrow('report must be an object');
    expect(() => mergeGpuThermalMarginReports([[]])).toThrow('report must be an object');
    expect(() => mergeGpuThermalMarginReports([report({ turbo: 'other' })]))
      .toThrow('requires a thermal-margin turbo report');
    expect(() => mergeGpuThermalMarginReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeGpuThermalMarginReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'criticalCount', 'elevatedCount']) {
      expect(() => mergeGpuThermalMarginReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeGpuThermalMarginReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeGpuThermalMarginReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildGpuThermalMarginEnvelope(report())).toThrow('trigger is required');
    expect(() => buildGpuThermalMarginEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildGpuThermalMarginEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildGpuThermalMarginEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
