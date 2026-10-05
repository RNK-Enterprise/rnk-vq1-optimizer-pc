import {
  MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_ID,
  MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_VERSION,
  buildMemoryPressureHeadroomVolatilityEnvelope,
  buildMemoryPressureHeadroomVolatilityPlan,
  createMemoryPressureHeadroomVolatilityLibrary,
  mergeMemoryPressureHeadroomVolatilityReports
} from '../pc/engines/memory-pressure/turbos/headroom-volatility/library.js';

function report(overrides = {}) {
  return {
    turbo: 'memory-pressure.headroom-volatility',
    state: 'stable-headroom',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    lowHeadroomCount: 0,
    meanHeadroom: 50,
    minimumHeadroom: 49,
    maximumHeadroom: 51,
    headroomRange: 2,
    standardDeviation: 1,
    slope: 0,
    confidence: 1,
    ...overrides
  };
}

describe('Memory-pressure headroom-volatility library', () => {
  test('publishes identity and merges weighted dispersion evidence', () => {
    const merged = mergeMemoryPressureHeadroomVolatilityReports([
      report({ state: 'stable-headroom', sampleCount: 2, observedCount: 2,
        meanHeadroom: 50, minimumHeadroom: 49, maximumHeadroom: 51,
        standardDeviation: 1, slope: 0 }),
      report({ state: 'volatile-headroom', sampleCount: 6, observedCount: 5,
        unknownCount: 1, meanHeadroom: 40, minimumHeadroom: 20, maximumHeadroom: 60,
        headroomRange: 40, standardDeviation: 20, slope: -5 })
    ]);
    expect(MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_ID)
      .toBe('memory-pressure.headroom-volatility.library');
    expect(MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'volatile-headroom',
      sampleCount: 8, observedCount: 7, unknownCount: 1, invalidCount: 0,
      meanHeadroom: 42.8571, minimumHeadroom: 20, maximumHeadroom: 60,
      headroomRange: 40, standardDeviation: 14.5714, slope: -3.5714,
      confidence: 0.875, recommendations: ['observe-memory-headroom-stability'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeMemoryPressureHeadroomVolatilityReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      meanHeadroom: null, minimumHeadroom: null, maximumHeadroom: null,
      headroomRange: null, standardDeviation: null, slope: null,
      recommendations: ['collect-more-headroom-samples']
    });
    expect(mergeMemoryPressureHeadroomVolatilityReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, meanHeadroom: null, minimumHeadroom: null,
      maximumHeadroom: null, headroomRange: null, standardDeviation: null, slope: null,
      confidence: 0 })])).toMatchObject({ state: 'no-observation', confidence: 0,
      recommendations: ['request-memory-headroom-observation'] });
    expect(mergeMemoryPressureHeadroomVolatilityReports([report({ state: 'invalid-headroom-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-headroom-evidence', recommendations: ['review-memory-sensor-range'] });
    expect(mergeMemoryPressureHeadroomVolatilityReports([report({ state: 'low-headroom', lowHeadroomCount: 1 })]))
      .toMatchObject({ state: 'low-headroom', recommendations: ['protect-memory-headroom', 'hold-destructive-actions'] });
    expect(mergeMemoryPressureHeadroomVolatilityReports([report({ state: 'volatile-headroom' })]))
      .toMatchObject({ state: 'volatile-headroom' });
    expect(mergeMemoryPressureHeadroomVolatilityReports([report({ state: 'shrinking-headroom', slope: -5 })]))
      .toMatchObject({ state: 'shrinking-headroom', recommendations: ['observe-memory-headroom-decline'] });
    expect(mergeMemoryPressureHeadroomVolatilityReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, meanHeadroom: null, minimumHeadroom: null,
      maximumHeadroom: null, headroomRange: null, standardDeviation: null, slope: null,
      confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeMemoryPressureHeadroomVolatilityReports([report({ state: 'stable-headroom' })]))
      .toMatchObject({ state: 'stable-headroom', recommendations: ['no-change'] });
    expect(mergeMemoryPressureHeadroomVolatilityReports([
      report({ state: 'no-observation' }), report({ state: 'insufficient-data', sampleCount: 1,
        observedCount: 0, unknownCount: 1, meanHeadroom: null, minimumHeadroom: null,
        maximumHeadroom: null, headroomRange: null, standardDeviation: null, slope: null,
        confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies severity precedence and builds every state plan', () => {
    expect(mergeMemoryPressureHeadroomVolatilityReports([
      report({ state: 'low-headroom', lowHeadroomCount: 1 }),
      report({ state: 'invalid-headroom-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-headroom-evidence' });
    expect(mergeMemoryPressureHeadroomVolatilityReports([
      report({ state: 'volatile-headroom' }), report({ state: 'low-headroom', lowHeadroomCount: 1 })
    ])).toMatchObject({ state: 'low-headroom' });
    expect(mergeMemoryPressureHeadroomVolatilityReports([
      report({ state: 'shrinking-headroom', slope: -5 }), report({ state: 'volatile-headroom' })
    ])).toMatchObject({ state: 'volatile-headroom' });

    const states = [
      ['invalid-headroom-evidence', 'sensor-review', 500],
      ['low-headroom', 'headroom-protection', 750],
      ['volatile-headroom', 'stability-observation', 750],
      ['shrinking-headroom', 'decline-observation', 1000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['stable-headroom', 'relaxed-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildMemoryPressureHeadroomVolatilityPlan(report({ state, sampleCount: 4, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildMemoryPressureHeadroomVolatilityPlan(report({ state: 'stable-headroom', sampleCount: 4,
      observedCount: 4 }), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildMemoryPressureHeadroomVolatilityPlan(report({ state: 'stable-headroom', sampleCount: 0,
      observedCount: 0, unknownCount: 0, meanHeadroom: null, minimumHeadroom: null,
      maximumHeadroom: null, headroomRange: null, standardDeviation: null, slope: null,
      confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildMemoryPressureHeadroomVolatilityEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createMemoryPressureHeadroomVolatilityLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      meanHeadroom: null, minimumHeadroom: null, maximumHeadroom: null,
      headroomRange: null, standardDeviation: null, slope: null, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, counts, metrics, limits, triggers, and clocks', () => {
    expect(() => mergeMemoryPressureHeadroomVolatilityReports(null)).toThrow('reports must be an array');
    expect(() => mergeMemoryPressureHeadroomVolatilityReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeMemoryPressureHeadroomVolatilityReports([null])).toThrow('report must be an object');
    expect(() => mergeMemoryPressureHeadroomVolatilityReports([[]])).toThrow('report must be an object');
    expect(() => mergeMemoryPressureHeadroomVolatilityReports([report({ turbo: 'other' })]))
      .toThrow('requires a headroom-volatility turbo report');
    expect(() => mergeMemoryPressureHeadroomVolatilityReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeMemoryPressureHeadroomVolatilityReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'lowHeadroomCount']) {
      expect(() => mergeMemoryPressureHeadroomVolatilityReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const field of ['meanHeadroom', 'minimumHeadroom', 'maximumHeadroom', 'headroomRange',
      'standardDeviation', 'slope']) {
      expect(() => mergeMemoryPressureHeadroomVolatilityReports([report({ [field]: 101 })]))
        .toThrow(`Headroom-volatility library ${field} is outside its bounded range`);
    }
    expect(() => mergeMemoryPressureHeadroomVolatilityReports([report({ meanHeadroom: '50' })]))
      .toThrow('meanHeadroom is outside its bounded range');
    expect(() => mergeMemoryPressureHeadroomVolatilityReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeMemoryPressureHeadroomVolatilityReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildMemoryPressureHeadroomVolatilityEnvelope(report())).toThrow('trigger is required');
    expect(() => buildMemoryPressureHeadroomVolatilityEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPressureHeadroomVolatilityEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPressureHeadroomVolatilityEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
