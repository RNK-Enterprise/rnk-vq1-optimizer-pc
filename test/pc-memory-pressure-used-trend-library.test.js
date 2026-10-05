import {
  MEMORY_PRESSURE_USED_TREND_LIBRARY_ID,
  MEMORY_PRESSURE_USED_TREND_LIBRARY_VERSION,
  buildMemoryPressureUsedTrendEnvelope,
  buildMemoryPressureUsedTrendPlan,
  createMemoryPressureUsedTrendLibrary,
  mergeMemoryPressureUsedTrendReports
} from '../pc/engines/memory-pressure/turbos/used-trend/library.js';

function report(overrides = {}) {
  return {
    turbo: 'memory-pressure.used-trend',
    state: 'stable-pressure',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    highPressureCount: 0,
    growthCount: 0,
    declineCount: 0,
    comparisonCount: 3,
    reversalCount: 1,
    averageAbsoluteDelta: 2,
    slope: 1,
    confidence: 1,
    ...overrides
  };
}

describe('Memory-pressure used-trend library', () => {
  test('publishes identity and merges weighted trend evidence', () => {
    const merged = mergeMemoryPressureUsedTrendReports([
      report({ state: 'stable-pressure', sampleCount: 2, observedCount: 2,
        comparisonCount: 1, averageAbsoluteDelta: 2, slope: 1 }),
      report({ state: 'rising-pressure', sampleCount: 6, observedCount: 5,
        unknownCount: 1, comparisonCount: 5, reversalCount: 2,
        averageAbsoluteDelta: 6, slope: 5 })
    ]);
    expect(MEMORY_PRESSURE_USED_TREND_LIBRARY_ID).toBe('memory-pressure.used-trend.library');
    expect(MEMORY_PRESSURE_USED_TREND_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'rising-pressure',
      sampleCount: 8, observedCount: 7, unknownCount: 1, invalidCount: 0,
      comparisonCount: 6, reversalCount: 3, averageAbsoluteDelta: 4.8571,
      slope: 3.8571, confidence: 0.875, recommendations: ['observe-memory-growth'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeMemoryPressureUsedTrendReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      averageAbsoluteDelta: null, slope: null, recommendations: ['collect-more-memory-samples']
    });
    expect(mergeMemoryPressureUsedTrendReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, reversalCount: 0,
      averageAbsoluteDelta: null, slope: null, confidence: 0 })])).toMatchObject({
      state: 'no-observation', confidence: 0, recommendations: ['request-memory-pressure-observation']
    });
    expect(mergeMemoryPressureUsedTrendReports([report({ state: 'invalid-pressure-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-pressure-evidence', recommendations: ['review-memory-sensor-range'] });
    expect(mergeMemoryPressureUsedTrendReports([report({ state: 'high-pressure', highPressureCount: 1 })]))
      .toMatchObject({ state: 'high-pressure', recommendations: ['protect-memory-headroom', 'hold-destructive-actions'] });
    expect(mergeMemoryPressureUsedTrendReports([report({ state: 'rising-pressure' })]))
      .toMatchObject({ state: 'rising-pressure' });
    expect(mergeMemoryPressureUsedTrendReports([report({ state: 'falling-pressure', declineCount: 1 })]))
      .toMatchObject({ state: 'falling-pressure', recommendations: ['observe-memory-recovery'] });
    expect(mergeMemoryPressureUsedTrendReports([report({ state: 'volatile-pressure' })]))
      .toMatchObject({ state: 'volatile-pressure', recommendations: ['observe-memory-pressure-stability'] });
    expect(mergeMemoryPressureUsedTrendReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, comparisonCount: 0, reversalCount: 0,
      averageAbsoluteDelta: null, slope: null, confidence: 0 })])).toMatchObject({
      state: 'insufficient-data' });
    expect(mergeMemoryPressureUsedTrendReports([report({ state: 'stable-pressure' })]))
      .toMatchObject({ state: 'stable-pressure', recommendations: ['no-change'] });
    expect(mergeMemoryPressureUsedTrendReports([
      report({ state: 'no-observation' }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0,
        unknownCount: 1, comparisonCount: 0, reversalCount: 0,
        averageAbsoluteDelta: null, slope: null, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies severity precedence and builds every state plan', () => {
    expect(mergeMemoryPressureUsedTrendReports([
      report({ state: 'high-pressure', highPressureCount: 1 }),
      report({ state: 'invalid-pressure-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-pressure-evidence' });
    expect(mergeMemoryPressureUsedTrendReports([
      report({ state: 'rising-pressure' }), report({ state: 'high-pressure', highPressureCount: 1 })
    ])).toMatchObject({ state: 'high-pressure' });
    expect(mergeMemoryPressureUsedTrendReports([
      report({ state: 'volatile-pressure' }), report({ state: 'falling-pressure', declineCount: 1 })
    ])).toMatchObject({ state: 'falling-pressure' });

    const states = [
      ['invalid-pressure-evidence', 'sensor-review', 500],
      ['high-pressure', 'headroom-protection', 750],
      ['rising-pressure', 'growth-observation', 1000],
      ['falling-pressure', 'recovery-observation', 1500],
      ['volatile-pressure', 'stability-observation', 750],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['stable-pressure', 'relaxed-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildMemoryPressureUsedTrendPlan(report({ state, sampleCount: 4, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildMemoryPressureUsedTrendPlan(report({ state: 'stable-pressure', sampleCount: 4,
      observedCount: 4 }), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildMemoryPressureUsedTrendPlan(report({ state: 'stable-pressure', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, reversalCount: 0,
      averageAbsoluteDelta: null, slope: null, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildMemoryPressureUsedTrendEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: MEMORY_PRESSURE_USED_TREND_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createMemoryPressureUsedTrendLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(MEMORY_PRESSURE_USED_TREND_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      comparisonCount: 0, reversalCount: 0, averageAbsoluteDelta: null,
      slope: null, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, counts, metrics, limits, triggers, and clocks', () => {
    expect(() => mergeMemoryPressureUsedTrendReports(null)).toThrow('reports must be an array');
    expect(() => mergeMemoryPressureUsedTrendReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeMemoryPressureUsedTrendReports([null])).toThrow('report must be an object');
    expect(() => mergeMemoryPressureUsedTrendReports([[]])).toThrow('report must be an object');
    expect(() => mergeMemoryPressureUsedTrendReports([report({ turbo: 'other' })]))
      .toThrow('requires a used-trend turbo report');
    expect(() => mergeMemoryPressureUsedTrendReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeMemoryPressureUsedTrendReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'highPressureCount',
      'growthCount', 'declineCount', 'comparisonCount', 'reversalCount']) {
      expect(() => mergeMemoryPressureUsedTrendReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const [field, value] of [['averageAbsoluteDelta', -1], ['averageAbsoluteDelta', 101],
      ['slope', -101], ['slope', 101]]) {
      expect(() => mergeMemoryPressureUsedTrendReports([report({ [field]: value })]))
        .toThrow(`Used-trend library ${field} is outside its bounded range`);
    }
    expect(() => mergeMemoryPressureUsedTrendReports([report({ averageAbsoluteDelta: '2' })]))
      .toThrow('averageAbsoluteDelta is outside its bounded range');
    expect(() => mergeMemoryPressureUsedTrendReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeMemoryPressureUsedTrendReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildMemoryPressureUsedTrendEnvelope(report())).toThrow('trigger is required');
    expect(() => buildMemoryPressureUsedTrendEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPressureUsedTrendEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPressureUsedTrendEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
