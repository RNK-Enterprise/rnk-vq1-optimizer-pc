import {
  CPU_UTILIZATION_SATURATION_LIBRARY_ID,
  CPU_UTILIZATION_SATURATION_LIBRARY_VERSION,
  buildCpuUtilizationSaturationEnvelope,
  buildCpuUtilizationSaturationPlan,
  createCpuUtilizationSaturationLibrary,
  mergeCpuUtilizationSaturationReports
} from '../pc/engines/cpu-utilization/turbos/saturation-guard/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-utilization.saturation-guard',
    state: 'clear',
    sampleCount: 4,
    observedCount: 4,
    saturationCount: 0,
    longestSaturationRun: 0,
    trailingSaturationRun: 0,
    recoveryTransitions: 0,
    ...overrides
  };
}

describe('CPU-utilization saturation-guard library', () => {
  test('publishes identity and merges bounded reports', () => {
    const merged = mergeCpuUtilizationSaturationReports([
      report({ state: 'intermittent-saturation', sampleCount: 2, observedCount: 2, saturationCount: 1,
        longestSaturationRun: 1, trailingSaturationRun: 1 }),
      report({ state: 'sustained-saturation', sampleCount: 6, observedCount: 5,
        saturationCount: 4, longestSaturationRun: 4, trailingSaturationRun: 4,
        recoveryTransitions: 1 })
    ]);
    expect(merged).toMatchObject({
      library: CPU_UTILIZATION_SATURATION_LIBRARY_ID,
      libraryVersion: CPU_UTILIZATION_SATURATION_LIBRARY_VERSION,
      reportCount: 2, state: 'sustained-saturation', saturationCount: 5,
      longestSaturationRun: 4, trailingSaturationRun: 4, recoveryTransitions: 1,
      sampleCount: 8, observedCount: 7, saturationRate: 0.625, confidence: 0.875,
      recommendations: ['protect-foreground']
    });
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(createCpuUtilizationSaturationLibrary())).toBe(true);
  });

  test('preserves every aggregate state and zero-sample confidence', () => {
    expect(mergeCpuUtilizationSaturationReports([report()])).toMatchObject({
      state: 'clear', recommendations: ['no-change']
    });
    expect(mergeCpuUtilizationSaturationReports([])).toMatchObject({
      reportCount: 0, state: 'insufficient-data', saturationCount: 0,
      longestSaturationRun: null, trailingSaturationRun: null, recoveryTransitions: 0,
      sampleCount: 0, observedCount: 0, saturationRate: null, confidence: 0,
      recommendations: ['collect-more-cpu-samples']
    });
    expect(mergeCpuUtilizationSaturationReports([report({ state: 'recovery-observed',
      recoveryTransitions: 1 })])).toMatchObject({ state: 'recovery-observed',
      recommendations: ['observe-recovery-window'] });
    expect(mergeCpuUtilizationSaturationReports([report({ state: 'intermittent-saturation',
      saturationCount: 1 })])).toMatchObject({ state: 'intermittent-saturation',
      recommendations: ['observe-next-cpu-sample'] });
    expect(mergeCpuUtilizationSaturationReports([report({ state: 'no-observation',
      sampleCount: 0, observedCount: 0 })])).toMatchObject({ state: 'no-observation',
      saturationRate: 0, confidence: 0, recommendations: ['request-cpu-utilization-observation'] });
    expect(mergeCpuUtilizationSaturationReports([report({ state: 'insufficient-data',
      sampleCount: 1, observedCount: 1 })])).toMatchObject({ state: 'insufficient-data', confidence: 1 });
  });

  test('builds state-specific plans and immutable envelopes', () => {
    expect(buildCpuUtilizationSaturationPlan(report({ state: 'sustained-saturation' }), 'interactive'))
      .toMatchObject({ environment: 'interactive', mode: 'protective-observation', intervalMs: 250, confidence: 1 });
    expect(buildCpuUtilizationSaturationPlan(report({ state: 'recovery-observed' }), 'headless'))
      .toMatchObject({ mode: 'recovery-observation', intervalMs: 500 });
    expect(buildCpuUtilizationSaturationPlan(report({ state: 'intermittent-saturation' }), 'headless'))
      .toMatchObject({ mode: 'contention-observation', intervalMs: 750 });
    expect(buildCpuUtilizationSaturationPlan(report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0 }), 'headless'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000, confidence: 0 });
    expect(buildCpuUtilizationSaturationPlan(report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 1 }), 'interactive'))
      .toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuUtilizationSaturationPlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuUtilizationSaturationPlan(report(), 'unclassified')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', intervalMs: 5000
    });
    const envelope = buildCpuUtilizationSaturationEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
  });

  test('rejects malformed reports, collections, triggers, clocks, and limits', () => {
    expect(() => mergeCpuUtilizationSaturationReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuUtilizationSaturationReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuUtilizationSaturationReports([null])).toThrow('report must be an object');
    expect(() => mergeCpuUtilizationSaturationReports([report({ turbo: 'other' })]))
      .toThrow('requires a saturation-guard turbo report');
    expect(() => mergeCpuUtilizationSaturationReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuUtilizationSaturationReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuUtilizationSaturationReports([report({ observedCount: 5 })]))
      .toThrow('observedCount must fit');
    expect(() => mergeCpuUtilizationSaturationReports([report({ saturationCount: 5 })]))
      .toThrow('saturationCount must fit');
    expect(() => mergeCpuUtilizationSaturationReports([report({ longestSaturationRun: 5 })]))
      .toThrow('longest run must fit');
    expect(() => mergeCpuUtilizationSaturationReports([report({ trailingSaturationRun: 5 })]))
      .toThrow('trailing run must fit');
    expect(() => mergeCpuUtilizationSaturationReports([report({ recoveryTransitions: -1 })]))
      .toThrow('recovery transitions must be non-negative');
    expect(() => buildCpuUtilizationSaturationEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuUtilizationSaturationEnvelope(report(), { trigger: '', now: () => 0 }))
      .toThrow('trigger is required');
    expect(() => buildCpuUtilizationSaturationEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
