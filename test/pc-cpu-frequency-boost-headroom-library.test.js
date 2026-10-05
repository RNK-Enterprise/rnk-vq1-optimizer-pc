import {
  CPU_FREQUENCY_HEADROOM_LIBRARY_ID,
  CPU_FREQUENCY_HEADROOM_LIBRARY_VERSION,
  buildCpuFrequencyHeadroomEnvelope,
  buildCpuFrequencyHeadroomPlan,
  createCpuFrequencyHeadroomLibrary,
  mergeCpuFrequencyHeadroomReports
} from '../pc/engines/cpu-frequency/turbos/boost-headroom/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-frequency.boost-headroom',
    state: 'request-satisfied',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    thermalCount: 0,
    thermalShortfallCount: 0,
    shortfallUnderLoadCount: 0,
    satisfiedCount: 4,
    shortfallCount: 0,
    averageHeadroom: 0,
    confidence: 1,
    ...overrides
  };
}

describe('CPU-frequency boost-headroom library', () => {
  test('publishes identity and merges weighted headroom evidence', () => {
    const merged = mergeCpuFrequencyHeadroomReports([
      report({ state: 'variable-headroom', sampleCount: 2, observedCount: 2,
        satisfiedCount: 1, shortfallCount: 1, averageHeadroom: 0.2 }),
      report({ state: 'thermal-limited', sampleCount: 6, observedCount: 5,
        unknownCount: 1, thermalCount: 4, thermalShortfallCount: 3,
        satisfiedCount: 2, shortfallCount: 3, averageHeadroom: 0.6 })
    ]);
    expect(CPU_FREQUENCY_HEADROOM_LIBRARY_ID).toBe('cpu-frequency.boost-headroom.library');
    expect(CPU_FREQUENCY_HEADROOM_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'thermal-limited',
      sampleCount: 8, observedCount: 7, unknownCount: 1, invalidCount: 0,
      thermalCount: 4, thermalShortfallCount: 3, satisfiedCount: 3,
      shortfallCount: 4, averageHeadroom: 0.4857, confidence: 0.875,
      recommendations: ['review-thermal-limits-before-frequency-control'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeCpuFrequencyHeadroomReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      averageHeadroom: null, recommendations: ['collect-more-frequency-samples']
    });
    expect(mergeCpuFrequencyHeadroomReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, satisfiedCount: 0, averageHeadroom: null,
      confidence: 0 })])).toMatchObject({ state: 'no-observation', confidence: 0,
      recommendations: ['request-boost-headroom-observation'] });
    expect(mergeCpuFrequencyHeadroomReports([report({ state: 'invalid-frequency-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-frequency-evidence', recommendations: ['review-frequency-sensor-range'] });
    expect(mergeCpuFrequencyHeadroomReports([report({ state: 'thermal-limited', thermalCount: 1,
      thermalShortfallCount: 1, satisfiedCount: 0, shortfallCount: 1 })])).toMatchObject({
      state: 'thermal-limited', recommendations: ['review-thermal-limits-before-frequency-control'] });
    expect(mergeCpuFrequencyHeadroomReports([report({ state: 'boost-shortfall-under-load',
      shortfallUnderLoadCount: 1, satisfiedCount: 0, shortfallCount: 1 })])).toMatchObject({
      state: 'boost-shortfall-under-load', recommendations: ['review-documented-boost-control'] });
    expect(mergeCpuFrequencyHeadroomReports([report({ state: 'variable-headroom',
      satisfiedCount: 1, shortfallCount: 1, averageHeadroom: 0.2 })])).toMatchObject({
      state: 'variable-headroom', recommendations: ['observe-requested-frequency-stability'] });
    expect(mergeCpuFrequencyHeadroomReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, satisfiedCount: 0, averageHeadroom: null,
      confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeCpuFrequencyHeadroomReports([report({ state: 'request-satisfied' })]))
      .toMatchObject({ state: 'request-satisfied', recommendations: ['no-change'] });
    expect(mergeCpuFrequencyHeadroomReports([report({ state: 'no-observation' }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0,
        unknownCount: 1, satisfiedCount: 0, averageHeadroom: null, confidence: 0 })]))
      .toMatchObject({ state: 'insufficient-data' });
  });

  test('applies severity precedence and builds every state plan', () => {
    expect(mergeCpuFrequencyHeadroomReports([
      report({ state: 'thermal-limited', thermalCount: 1, thermalShortfallCount: 1,
        satisfiedCount: 0, shortfallCount: 1 }),
      report({ state: 'invalid-frequency-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-frequency-evidence' });
    expect(mergeCpuFrequencyHeadroomReports([
      report({ state: 'boost-shortfall-under-load', shortfallUnderLoadCount: 1,
        satisfiedCount: 0, shortfallCount: 1 }),
      report({ state: 'thermal-limited', thermalCount: 1, thermalShortfallCount: 1,
        satisfiedCount: 0, shortfallCount: 1 })
    ])).toMatchObject({ state: 'thermal-limited' });
    expect(mergeCpuFrequencyHeadroomReports([
      report({ state: 'variable-headroom', satisfiedCount: 1, shortfallCount: 1,
        averageHeadroom: 0.2 }), report({ state: 'boost-shortfall-under-load',
        shortfallUnderLoadCount: 1, satisfiedCount: 0, shortfallCount: 1 })
    ])).toMatchObject({ state: 'boost-shortfall-under-load' });

    const states = [
      ['invalid-frequency-evidence', 'sensor-review', 500],
      ['thermal-limited', 'thermal-review', 750],
      ['boost-shortfall-under-load', 'boost-review', 1000],
      ['variable-headroom', 'headroom-observation', 1000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['request-satisfied', 'relaxed-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildCpuFrequencyHeadroomPlan(report({ state, sampleCount: 4, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildCpuFrequencyHeadroomPlan(report({ state: 'request-satisfied', sampleCount: 4,
      observedCount: 4 }), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildCpuFrequencyHeadroomPlan(report({ state: 'request-satisfied', sampleCount: 0,
      observedCount: 0, unknownCount: 0, satisfiedCount: 0, averageHeadroom: null,
      confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildCpuFrequencyHeadroomEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: CPU_FREQUENCY_HEADROOM_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createCpuFrequencyHeadroomLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(CPU_FREQUENCY_HEADROOM_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      satisfiedCount: 0, averageHeadroom: null, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, counts, headroom, limits, triggers, and clocks', () => {
    expect(() => mergeCpuFrequencyHeadroomReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuFrequencyHeadroomReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuFrequencyHeadroomReports([null])).toThrow('report must be an object');
    expect(() => mergeCpuFrequencyHeadroomReports([[]])).toThrow('report must be an object');
    expect(() => mergeCpuFrequencyHeadroomReports([report({ turbo: 'other' })]))
      .toThrow('requires a boost-headroom turbo report');
    expect(() => mergeCpuFrequencyHeadroomReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuFrequencyHeadroomReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'thermalCount',
      'thermalShortfallCount', 'shortfallUnderLoadCount', 'satisfiedCount', 'shortfallCount']) {
      expect(() => mergeCpuFrequencyHeadroomReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeCpuFrequencyHeadroomReports([report({ averageHeadroom: 2 })]))
      .toThrow('averageHeadroom must be between 0 and 1');
    expect(() => mergeCpuFrequencyHeadroomReports([report({ averageHeadroom: '1' })]))
      .toThrow('averageHeadroom must be between 0 and 1');
    expect(() => mergeCpuFrequencyHeadroomReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeCpuFrequencyHeadroomReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildCpuFrequencyHeadroomEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuFrequencyHeadroomEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildCpuFrequencyHeadroomEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildCpuFrequencyHeadroomEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
