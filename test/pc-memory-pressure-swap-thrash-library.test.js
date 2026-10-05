import {
  MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_ID,
  MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_VERSION,
  buildMemoryPressureSwapThrashEnvelope,
  buildMemoryPressureSwapThrashPlan,
  createMemoryPressureSwapThrashLibrary,
  mergeMemoryPressureSwapThrashReports
} from '../pc/engines/memory-pressure/turbos/swap-thrash/library.js';

function report(overrides = {}) {
  return {
    turbo: 'memory-pressure.swap-thrash',
    state: 'stable-swap',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    activeCount: 0,
    reclaimCount: 0,
    growthCount: 0,
    comparisonCount: 3,
    reversalCount: 1,
    averageAbsoluteDelta: 2,
    slope: 1,
    confidence: 1,
    ...overrides
  };
}

describe('Memory-pressure swap-thrash library', () => {
  test('publishes identity and merges weighted swap evidence', () => {
    const merged = mergeMemoryPressureSwapThrashReports([
      report({ state: 'stable-swap', sampleCount: 2, observedCount: 2,
        comparisonCount: 1, averageAbsoluteDelta: 2, slope: 1 }),
      report({ state: 'rising-swap', sampleCount: 6, observedCount: 5,
        unknownCount: 1, comparisonCount: 5, reversalCount: 2,
        averageAbsoluteDelta: 6, slope: 5 })
    ]);
    expect(MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_ID).toBe('memory-pressure.swap-thrash.library');
    expect(MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'rising-swap',
      sampleCount: 8, observedCount: 7, unknownCount: 1, invalidCount: 0,
      comparisonCount: 6, reversalCount: 3, averageAbsoluteDelta: 4.8571,
      slope: 3.8571, confidence: 0.875, recommendations: ['observe-swap-growth'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeMemoryPressureSwapThrashReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      averageAbsoluteDelta: null, slope: null, recommendations: ['collect-more-swap-samples']
    });
    expect(mergeMemoryPressureSwapThrashReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, reversalCount: 0,
      averageAbsoluteDelta: null, slope: null, confidence: 0 })])).toMatchObject({
      state: 'no-observation', confidence: 0, recommendations: ['request-swap-activity-observation']
    });
    expect(mergeMemoryPressureSwapThrashReports([report({ state: 'invalid-swap-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-swap-evidence', recommendations: ['review-swap-sensor-range'] });
    expect(mergeMemoryPressureSwapThrashReports([report({ state: 'active-thrash', activeCount: 1 })]))
      .toMatchObject({ state: 'active-thrash', recommendations: ['review-memory-pressure-before-swap-control'] });
    expect(mergeMemoryPressureSwapThrashReports([report({ state: 'reclaim-churn', reclaimCount: 1 })]))
      .toMatchObject({ state: 'reclaim-churn', recommendations: ['observe-reclaim-activity'] });
    expect(mergeMemoryPressureSwapThrashReports([report({ state: 'rising-swap' })]))
      .toMatchObject({ state: 'rising-swap' });
    expect(mergeMemoryPressureSwapThrashReports([report({ state: 'volatile-swap' })]))
      .toMatchObject({ state: 'volatile-swap', recommendations: ['observe-swap-stability'] });
    expect(mergeMemoryPressureSwapThrashReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, comparisonCount: 0, reversalCount: 0,
      averageAbsoluteDelta: null, slope: null, confidence: 0 })])).toMatchObject({
      state: 'insufficient-data' });
    expect(mergeMemoryPressureSwapThrashReports([report({ state: 'stable-swap' })]))
      .toMatchObject({ state: 'stable-swap', recommendations: ['no-change'] });
    expect(mergeMemoryPressureSwapThrashReports([
      report({ state: 'no-observation' }), report({ state: 'insufficient-data', sampleCount: 1,
        observedCount: 0, unknownCount: 1, comparisonCount: 0, reversalCount: 0,
        averageAbsoluteDelta: null, slope: null, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies severity precedence and builds every state plan', () => {
    expect(mergeMemoryPressureSwapThrashReports([
      report({ state: 'active-thrash', activeCount: 1 }),
      report({ state: 'invalid-swap-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-swap-evidence' });
    expect(mergeMemoryPressureSwapThrashReports([
      report({ state: 'reclaim-churn', reclaimCount: 1 }), report({ state: 'active-thrash', activeCount: 1 })
    ])).toMatchObject({ state: 'active-thrash' });
    expect(mergeMemoryPressureSwapThrashReports([
      report({ state: 'volatile-swap' }), report({ state: 'rising-swap' })
    ])).toMatchObject({ state: 'rising-swap' });

    const states = [
      ['invalid-swap-evidence', 'sensor-review', 500],
      ['active-thrash', 'pressure-review', 750],
      ['reclaim-churn', 'reclaim-observation', 1000],
      ['rising-swap', 'growth-observation', 1000],
      ['volatile-swap', 'stability-observation', 750],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['stable-swap', 'relaxed-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildMemoryPressureSwapThrashPlan(report({ state, sampleCount: 4, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildMemoryPressureSwapThrashPlan(report({ state: 'stable-swap', sampleCount: 4,
      observedCount: 4 }), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildMemoryPressureSwapThrashPlan(report({ state: 'stable-swap', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, reversalCount: 0,
      averageAbsoluteDelta: null, slope: null, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildMemoryPressureSwapThrashEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createMemoryPressureSwapThrashLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      comparisonCount: 0, reversalCount: 0, averageAbsoluteDelta: null,
      slope: null, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, counts, metrics, limits, triggers, and clocks', () => {
    expect(() => mergeMemoryPressureSwapThrashReports(null)).toThrow('reports must be an array');
    expect(() => mergeMemoryPressureSwapThrashReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeMemoryPressureSwapThrashReports([null])).toThrow('report must be an object');
    expect(() => mergeMemoryPressureSwapThrashReports([[]])).toThrow('report must be an object');
    expect(() => mergeMemoryPressureSwapThrashReports([report({ turbo: 'other' })]))
      .toThrow('requires a swap-thrash turbo report');
    expect(() => mergeMemoryPressureSwapThrashReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeMemoryPressureSwapThrashReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'activeCount',
      'reclaimCount', 'growthCount', 'comparisonCount', 'reversalCount']) {
      expect(() => mergeMemoryPressureSwapThrashReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const [field, value] of [['averageAbsoluteDelta', -1], ['averageAbsoluteDelta', 101],
      ['slope', -101], ['slope', 101]]) {
      expect(() => mergeMemoryPressureSwapThrashReports([report({ [field]: value })]))
        .toThrow(`Swap-thrash library ${field} is outside its bounded range`);
    }
    expect(() => mergeMemoryPressureSwapThrashReports([report({ averageAbsoluteDelta: '2' })]))
      .toThrow('averageAbsoluteDelta is outside its bounded range');
    expect(() => mergeMemoryPressureSwapThrashReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeMemoryPressureSwapThrashReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildMemoryPressureSwapThrashEnvelope(report())).toThrow('trigger is required');
    expect(() => buildMemoryPressureSwapThrashEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPressureSwapThrashEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPressureSwapThrashEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
