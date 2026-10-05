import {
  CPU_FREQUENCY_RESIDENCY_LIBRARY_ID,
  CPU_FREQUENCY_RESIDENCY_LIBRARY_VERSION,
  buildCpuFrequencyResidencyEnvelope,
  buildCpuFrequencyResidencyPlan,
  createCpuFrequencyResidencyLibrary,
  mergeCpuFrequencyResidencyReports
} from '../pc/engines/cpu-frequency/turbos/frequency-residency/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-frequency.frequency-residency',
    state: 'balanced-residency',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    lowUnderLoadCount: 0,
    boostCount: 0,
    comparisonCount: 3,
    transitionCount: 1,
    averageRatio: 1,
    confidence: 1,
    ...overrides
  };
}

describe('CPU-frequency frequency-residency library', () => {
  test('publishes identity and merges weighted residency evidence', () => {
    const merged = mergeCpuFrequencyResidencyReports([
      report({ state: 'balanced-residency', sampleCount: 2, observedCount: 2,
        comparisonCount: 1, averageRatio: 0.8 }),
      report({ state: 'unstable-residency', sampleCount: 6, observedCount: 5,
        unknownCount: 1, comparisonCount: 5, transitionCount: 4, averageRatio: 1.2 })
    ]);
    expect(CPU_FREQUENCY_RESIDENCY_LIBRARY_ID).toBe('cpu-frequency.frequency-residency.library');
    expect(CPU_FREQUENCY_RESIDENCY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'unstable-residency',
      sampleCount: 8, observedCount: 7, unknownCount: 1, invalidCount: 0,
      comparisonCount: 6, transitionCount: 5, averageRatio: 1.0857,
      confidence: 0.875, recommendations: ['observe-frequency-residency-stability'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeCpuFrequencyResidencyReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      averageRatio: null, recommendations: ['collect-more-frequency-samples']
    });
    expect(mergeCpuFrequencyResidencyReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, transitionCount: 0,
      averageRatio: null, confidence: 0 })])).toMatchObject({
      state: 'no-observation', confidence: 0, recommendations: ['request-frequency-residency-observation']
    });
    expect(mergeCpuFrequencyResidencyReports([report({ state: 'invalid-frequency-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-frequency-evidence', recommendations: ['review-frequency-sensor-range'] });
    expect(mergeCpuFrequencyResidencyReports([report({ state: 'low-residency-under-load', lowUnderLoadCount: 1 })]))
      .toMatchObject({ state: 'low-residency-under-load', recommendations: ['review-documented-frequency-control'] });
    expect(mergeCpuFrequencyResidencyReports([report({ state: 'sustained-boost-residency', boostCount: 1 })]))
      .toMatchObject({ state: 'sustained-boost-residency', recommendations: ['observe-boost-duration-and-thermal-state'] });
    expect(mergeCpuFrequencyResidencyReports([report({ state: 'unstable-residency' })]))
      .toMatchObject({ state: 'unstable-residency', recommendations: ['observe-frequency-residency-stability'] });
    expect(mergeCpuFrequencyResidencyReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, comparisonCount: 0, transitionCount: 0,
      averageRatio: null, confidence: 0 })])).toMatchObject({
      state: 'insufficient-data' });
    expect(mergeCpuFrequencyResidencyReports([report({ state: 'balanced-residency' })]))
      .toMatchObject({ state: 'balanced-residency', recommendations: ['no-change'] });
    expect(mergeCpuFrequencyResidencyReports([report({ state: 'no-observation' }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0,
        unknownCount: 1, comparisonCount: 0, transitionCount: 0,
        averageRatio: null, confidence: 0 })])).toMatchObject({
      state: 'insufficient-data' });
  });

  test('applies severity precedence and builds every state plan', () => {
    expect(mergeCpuFrequencyResidencyReports([
      report({ state: 'low-residency-under-load' }),
      report({ state: 'invalid-frequency-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-frequency-evidence' });
    expect(mergeCpuFrequencyResidencyReports([
      report({ state: 'sustained-boost-residency' }), report({ state: 'low-residency-under-load' })
    ])).toMatchObject({ state: 'low-residency-under-load' });
    expect(mergeCpuFrequencyResidencyReports([
      report({ state: 'unstable-residency' }), report({ state: 'sustained-boost-residency' })
    ])).toMatchObject({ state: 'sustained-boost-residency' });

    const states = [
      ['invalid-frequency-evidence', 'sensor-review', 500],
      ['low-residency-under-load', 'load-review', 1000],
      ['sustained-boost-residency', 'boost-observation', 1500],
      ['unstable-residency', 'stability-observation', 750],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['balanced-residency', 'relaxed-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildCpuFrequencyResidencyPlan(report({ state, sampleCount: 4, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildCpuFrequencyResidencyPlan(report({ state: 'balanced-residency', sampleCount: 4,
      observedCount: 4 }), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildCpuFrequencyResidencyPlan(report({ state: 'balanced-residency', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, transitionCount: 0,
      averageRatio: null, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildCpuFrequencyResidencyEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: CPU_FREQUENCY_RESIDENCY_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createCpuFrequencyResidencyLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(CPU_FREQUENCY_RESIDENCY_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      comparisonCount: 0, transitionCount: 0, averageRatio: null, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, counts, ratios, limits, triggers, and clocks', () => {
    expect(() => mergeCpuFrequencyResidencyReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuFrequencyResidencyReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuFrequencyResidencyReports([null])).toThrow('report must be an object');
    expect(() => mergeCpuFrequencyResidencyReports([[]])).toThrow('report must be an object');
    expect(() => mergeCpuFrequencyResidencyReports([report({ turbo: 'other' })]))
      .toThrow('requires a frequency-residency turbo report');
    expect(() => mergeCpuFrequencyResidencyReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuFrequencyResidencyReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'lowUnderLoadCount',
      'boostCount', 'comparisonCount', 'transitionCount']) {
      expect(() => mergeCpuFrequencyResidencyReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeCpuFrequencyResidencyReports([report({ averageRatio: 3 })]))
      .toThrow('averageRatio must be between 0 and 2');
    expect(() => mergeCpuFrequencyResidencyReports([report({ averageRatio: '1' })]))
      .toThrow('averageRatio must be between 0 and 2');
    expect(() => mergeCpuFrequencyResidencyReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeCpuFrequencyResidencyReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildCpuFrequencyResidencyEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuFrequencyResidencyEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildCpuFrequencyResidencyEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildCpuFrequencyResidencyEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
