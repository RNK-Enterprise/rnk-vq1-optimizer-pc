import {
  CPU_FREQUENCY_LOAD_LIBRARY_ID,
  CPU_FREQUENCY_LOAD_LIBRARY_VERSION,
  buildCpuFrequencyLoadEnvelope,
  buildCpuFrequencyLoadPlan,
  createCpuFrequencyLoadLibrary,
  mergeCpuFrequencyLoadReports
} from '../pc/engines/cpu-frequency/turbos/load-governor-mismatch/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-frequency.load-governor-mismatch',
    state: 'aligned-window',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    powersaveUnderLoadCount: 1,
    performanceUnderIdleCount: 1,
    mismatchRate: 0.5,
    ...overrides
  };
}

describe('CPU-frequency load-governor-mismatch library', () => {
  test('publishes identity and merges weighted load-policy evidence', () => {
    const merged = mergeCpuFrequencyLoadReports([
      report({ state: 'mismatch-burst', sampleCount: 2, observedCount: 2,
        powersaveUnderLoadCount: 1, performanceUnderIdleCount: 0, mismatchRate: 0.5 }),
      report({ state: 'powersave-under-load', sampleCount: 6, observedCount: 5,
        unknownCount: 1, powersaveUnderLoadCount: 4, performanceUnderIdleCount: 0, mismatchRate: 0.6667 })
    ]);
    expect(CPU_FREQUENCY_LOAD_LIBRARY_ID).toBe('cpu-frequency.load-governor-mismatch.library');
    expect(CPU_FREQUENCY_LOAD_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'powersave-under-load',
      observedCount: 7, unknownCount: 1, powersaveUnderLoadCount: 5,
      performanceUnderIdleCount: 0, mismatchRate: 0.625, sampleCount: 8,
      confidence: 0.875, recommendations: ['review-documented-frequency-control'] });
  });

  test('preserves every aggregate state and zero-sample confidence', () => {
    expect(mergeCpuFrequencyLoadReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0, recommendations: ['collect-more-frequency-samples']
    });
    expect(mergeCpuFrequencyLoadReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, powersaveUnderLoadCount: 0,
      performanceUnderIdleCount: 0, mismatchRate: 0 })])).toMatchObject({ state: 'no-observation', confidence: 0,
      recommendations: ['request-load-governor-observation'] });
    expect(mergeCpuFrequencyLoadReports([report({ state: 'powersave-under-load' })]))
      .toMatchObject({ state: 'powersave-under-load', recommendations: ['review-documented-frequency-control'] });
    expect(mergeCpuFrequencyLoadReports([report({ state: 'performance-under-idle' })]))
      .toMatchObject({ state: 'performance-under-idle', recommendations: ['review-idle-frequency-control'] });
    expect(mergeCpuFrequencyLoadReports([report({ state: 'mismatch-burst' })]))
      .toMatchObject({ state: 'mismatch-burst', recommendations: ['observe-load-governor-alignment'] });
    expect(mergeCpuFrequencyLoadReports([report({ state: 'aligned-window' })]))
      .toMatchObject({ state: 'aligned-window', recommendations: ['no-change'] });
    expect(mergeCpuFrequencyLoadReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, powersaveUnderLoadCount: 0,
      performanceUnderIdleCount: 0, mismatchRate: 0 })])).toMatchObject({ state: 'insufficient-data' });
  });

  test('builds state-specific plans, envelopes, and a frozen factory', () => {
    expect(buildCpuFrequencyLoadPlan(report({ state: 'powersave-under-load' }), 'interactive'))
      .toMatchObject({ mode: 'throughput-policy-review', intervalMs: 500 });
    expect(buildCpuFrequencyLoadPlan(report({ state: 'performance-under-idle' }), 'headless'))
      .toMatchObject({ mode: 'idle-policy-review', intervalMs: 500 });
    expect(buildCpuFrequencyLoadPlan(report({ state: 'mismatch-burst' }), 'interactive'))
      .toMatchObject({ mode: 'alignment-observation', intervalMs: 750 });
    expect(buildCpuFrequencyLoadPlan(report({ state: 'no-observation' }), 'interactive'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000 });
    expect(buildCpuFrequencyLoadPlan(report({ state: 'insufficient-data' }), 'interactive'))
      .toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuFrequencyLoadPlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuFrequencyLoadPlan(report({ observedCount: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
    const envelope = buildCpuFrequencyLoadEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: CPU_FREQUENCY_LOAD_LIBRARY_ID,
      trigger: 'health.interval', generatedAt: new Date(0).toISOString() });
    const factory = createCpuFrequencyLoadLibrary();
    expect(Object.isFrozen(factory)).toBe(true);
    expect(factory.id).toBe(CPU_FREQUENCY_LOAD_LIBRARY_ID);
    expect(factory.version).toBe(1);
    expect(factory.merge([])).toMatchObject({ state: 'insufficient-data' });
  });

  test('rejects malformed reports, limits, fields, triggers, and clocks', () => {
    expect(() => mergeCpuFrequencyLoadReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuFrequencyLoadReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuFrequencyLoadReports([report({ turbo: 'other' })]))
      .toThrow('requires a load-governor-mismatch turbo report');
    expect(() => mergeCpuFrequencyLoadReports([report({ state: 'bad' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuFrequencyLoadReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuFrequencyLoadReports([report({ observedCount: 5 })]))
      .toThrow('observed count must fit');
    expect(() => mergeCpuFrequencyLoadReports([report({ unknownCount: 5 })]))
      .toThrow('unknown count must fit');
    expect(() => mergeCpuFrequencyLoadReports([report({ powersaveUnderLoadCount: 5 })]))
      .toThrow('powersave count must fit');
    expect(() => mergeCpuFrequencyLoadReports([report({ performanceUnderIdleCount: 5 })]))
      .toThrow('performance count must fit');
    expect(() => mergeCpuFrequencyLoadReports([report({ mismatchRate: 2 })]))
      .toThrow('mismatchRate must be between');
    expect(() => buildCpuFrequencyLoadEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuFrequencyLoadEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => mergeCpuFrequencyLoadReports([null])).toThrow('report must be an object');
  });
});
