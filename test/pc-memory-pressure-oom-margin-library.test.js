import {
  MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_ID,
  MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_VERSION,
  buildMemoryPressureOomMarginEnvelope,
  buildMemoryPressureOomMarginPlan,
  createMemoryPressureOomMarginLibrary,
  mergeMemoryPressureOomMarginReports
} from '../pc/engines/memory-pressure/turbos/oom-margin/library.js';

function report(overrides = {}) {
  return {
    turbo: 'memory-pressure.oom-margin',
    state: 'safe-margin',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    criticalCount: 0,
    narrowCount: 0,
    meanMargin: 50,
    minimumMargin: 49,
    slope: 0,
    confidence: 1,
    ...overrides
  };
}

describe('Memory-pressure oom-margin library', () => {
  test('publishes identity and merges weighted margin evidence', () => {
    const merged = mergeMemoryPressureOomMarginReports([
      report({ state: 'safe-margin', sampleCount: 2, observedCount: 2,
        meanMargin: 50, minimumMargin: 49, slope: 0 }),
      report({ state: 'converging-margin', sampleCount: 6, observedCount: 5,
        unknownCount: 1, meanMargin: 40, minimumMargin: 20, slope: -5 })
    ]);
    expect(MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_ID).toBe('memory-pressure.oom-margin.library');
    expect(MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'converging-margin',
      sampleCount: 8, observedCount: 7, unknownCount: 1, invalidCount: 0,
      criticalCount: 0, narrowCount: 0, meanMargin: 42.8571, minimumMargin: 20,
      slope: -3.5714, confidence: 0.875, recommendations: ['observe-memory-margin-decline'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeMemoryPressureOomMarginReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      meanMargin: null, minimumMargin: null, slope: null,
      recommendations: ['collect-more-margin-samples']
    });
    expect(mergeMemoryPressureOomMarginReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, meanMargin: null, minimumMargin: null,
      slope: null, confidence: 0 })])).toMatchObject({ state: 'no-observation', confidence: 0,
      recommendations: ['request-memory-margin-observation'] });
    expect(mergeMemoryPressureOomMarginReports([report({ state: 'invalid-margin-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-margin-evidence', recommendations: ['review-memory-sensor-range'] });
    expect(mergeMemoryPressureOomMarginReports([report({ state: 'critical-margin', criticalCount: 1,
      narrowCount: 1, meanMargin: 2, minimumMargin: 1 })])).toMatchObject({
      state: 'critical-margin', recommendations: ['protect-critical-memory-margin', 'hold-destructive-actions'] });
    expect(mergeMemoryPressureOomMarginReports([report({ state: 'narrow-margin', narrowCount: 1,
      meanMargin: 12, minimumMargin: 10 })])).toMatchObject({
      state: 'narrow-margin', recommendations: ['protect-memory-margin', 'observe-next-sample'] });
    expect(mergeMemoryPressureOomMarginReports([report({ state: 'converging-margin', slope: -5 })]))
      .toMatchObject({ state: 'converging-margin' });
    expect(mergeMemoryPressureOomMarginReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, meanMargin: null, minimumMargin: null,
      slope: null, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeMemoryPressureOomMarginReports([report({ state: 'safe-margin' })]))
      .toMatchObject({ state: 'safe-margin', recommendations: ['no-change'] });
    expect(mergeMemoryPressureOomMarginReports([
      report({ state: 'no-observation' }), report({ state: 'insufficient-data', sampleCount: 1,
        observedCount: 0, unknownCount: 1, meanMargin: null, minimumMargin: null,
        slope: null, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies severity precedence and builds every state plan', () => {
    expect(mergeMemoryPressureOomMarginReports([
      report({ state: 'critical-margin', criticalCount: 1 }),
      report({ state: 'invalid-margin-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-margin-evidence' });
    expect(mergeMemoryPressureOomMarginReports([
      report({ state: 'narrow-margin', narrowCount: 1 }), report({ state: 'critical-margin', criticalCount: 1 })
    ])).toMatchObject({ state: 'critical-margin' });
    expect(mergeMemoryPressureOomMarginReports([
      report({ state: 'converging-margin', slope: -5 }), report({ state: 'narrow-margin', narrowCount: 1 })
    ])).toMatchObject({ state: 'narrow-margin' });

    const states = [
      ['invalid-margin-evidence', 'sensor-review', 500],
      ['critical-margin', 'critical-protection', 500],
      ['narrow-margin', 'margin-protection', 750],
      ['converging-margin', 'decline-observation', 1000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['safe-margin', 'relaxed-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildMemoryPressureOomMarginPlan(report({ state, sampleCount: 4, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildMemoryPressureOomMarginPlan(report({ state: 'safe-margin', sampleCount: 4,
      observedCount: 4 }), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildMemoryPressureOomMarginPlan(report({ state: 'safe-margin', sampleCount: 0,
      observedCount: 0, unknownCount: 0, meanMargin: null, minimumMargin: null,
      slope: null, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildMemoryPressureOomMarginEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createMemoryPressureOomMarginLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      meanMargin: null, minimumMargin: null, slope: null, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, counts, metrics, limits, triggers, and clocks', () => {
    expect(() => mergeMemoryPressureOomMarginReports(null)).toThrow('reports must be an array');
    expect(() => mergeMemoryPressureOomMarginReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeMemoryPressureOomMarginReports([null])).toThrow('report must be an object');
    expect(() => mergeMemoryPressureOomMarginReports([[]])).toThrow('report must be an object');
    expect(() => mergeMemoryPressureOomMarginReports([report({ turbo: 'other' })]))
      .toThrow('requires an oom-margin turbo report');
    expect(() => mergeMemoryPressureOomMarginReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeMemoryPressureOomMarginReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'criticalCount', 'narrowCount']) {
      expect(() => mergeMemoryPressureOomMarginReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const field of ['meanMargin', 'minimumMargin', 'slope']) {
      expect(() => mergeMemoryPressureOomMarginReports([report({ [field]: 101 })]))
        .toThrow(`OOM-margin library ${field} is outside its bounded range`);
    }
    expect(() => mergeMemoryPressureOomMarginReports([report({ meanMargin: '50' })]))
      .toThrow('meanMargin is outside its bounded range');
    expect(() => mergeMemoryPressureOomMarginReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeMemoryPressureOomMarginReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildMemoryPressureOomMarginEnvelope(report())).toThrow('trigger is required');
    expect(() => buildMemoryPressureOomMarginEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPressureOomMarginEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPressureOomMarginEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
