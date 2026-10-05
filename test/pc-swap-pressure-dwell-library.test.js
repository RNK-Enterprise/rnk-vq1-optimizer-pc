import {
  SWAP_PRESSURE_DWELL_LIBRARY_ID,
  SWAP_PRESSURE_DWELL_LIBRARY_VERSION,
  buildSwapPressureDwellEnvelope,
  buildSwapPressureDwellPlan,
  createSwapPressureDwellLibrary,
  mergeSwapPressureDwellReports
} from '../pc/engines/swap/turbos/pressure-dwell/library.js';

function report(overrides = {}) {
  return {
    turbo: 'swap.pressure-dwell',
    state: 'transient-or-normal',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    highCount: 0,
    elevatedCount: 0,
    confidence: 1,
    ...overrides
  };
}

describe('Swap pressure-dwell library', () => {
  test('publishes identity and merges pressure persistence evidence', () => {
    const merged = mergeSwapPressureDwellReports([
      report({ sampleCount: 2, observedCount: 2 }),
      report({ state: 'sustained-high', sampleCount: 6, observedCount: 5,
        unknownCount: 1, highCount: 3, elevatedCount: 1, confidence: 0.8333 })
    ]);
    expect(SWAP_PRESSURE_DWELL_LIBRARY_ID).toBe('swap.pressure-dwell.library');
    expect(SWAP_PRESSURE_DWELL_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'sustained-high',
      sampleCount: 8, observedCount: 7, unknownCount: 1, highCount: 3,
      elevatedCount: 1, confidence: 0.875,
      recommendations: ['hold-destructive-actions', 'review-memory-pressure'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeSwapPressureDwellReports([])).toMatchObject({ state: 'insufficient-data',
      reportCount: 0, confidence: 0, recommendations: ['collect-more-swap-pressure-samples'] });
    expect(mergeSwapPressureDwellReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, confidence: 0 })])).toMatchObject({ state: 'no-observation',
        confidence: 0, recommendations: ['request-swap-observation'] });
    expect(mergeSwapPressureDwellReports([report({ state: 'invalid-pressure-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-pressure-evidence', recommendations: ['review-swap-sensor-range'] });
    expect(mergeSwapPressureDwellReports([report({ state: 'sustained-elevated', elevatedCount: 2 })]))
      .toMatchObject({ state: 'sustained-elevated', recommendations: ['observe-next-swap-sample', 'review-documented-swap-policy'] });
    expect(mergeSwapPressureDwellReports([report({ state: 'transient-or-normal' })]))
      .toMatchObject({ state: 'transient-or-normal', recommendations: ['no-change'] });
    expect(mergeSwapPressureDwellReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeSwapPressureDwellReports([report({ state: 'no-observation' }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies precedence and builds every state plan', () => {
    expect(mergeSwapPressureDwellReports([
      report({ state: 'sustained-high', highCount: 1 }),
      report({ state: 'invalid-pressure-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-pressure-evidence' });
    expect(mergeSwapPressureDwellReports([
      report({ state: 'sustained-elevated', elevatedCount: 1 }),
      report({ state: 'sustained-high', highCount: 1 })
    ])).toMatchObject({ state: 'sustained-high' });

    const states = [
      ['invalid-pressure-evidence', 'sensor-review', 500],
      ['sustained-high', 'pressure-protection', 750],
      ['sustained-elevated', 'elevated-observation', 1000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['transient-or-normal', 'relaxed-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildSwapPressureDwellPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildSwapPressureDwellPlan(report({ state: 'transient-or-normal' }), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildSwapPressureDwellPlan(report({ state: 'transient-or-normal', sampleCount: 0,
      observedCount: 0, unknownCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildSwapPressureDwellEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: SWAP_PRESSURE_DWELL_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createSwapPressureDwellLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(SWAP_PRESSURE_DWELL_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeSwapPressureDwellReports(null)).toThrow('reports must be an array');
    expect(() => mergeSwapPressureDwellReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeSwapPressureDwellReports([null])).toThrow('report must be an object');
    expect(() => mergeSwapPressureDwellReports([[]])).toThrow('report must be an object');
    expect(() => mergeSwapPressureDwellReports([report({ turbo: 'other' })]))
      .toThrow('requires a pressure-dwell turbo report');
    expect(() => mergeSwapPressureDwellReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeSwapPressureDwellReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'highCount', 'elevatedCount']) {
      expect(() => mergeSwapPressureDwellReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeSwapPressureDwellReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeSwapPressureDwellReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildSwapPressureDwellEnvelope(report())).toThrow('trigger is required');
    expect(() => buildSwapPressureDwellEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildSwapPressureDwellEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildSwapPressureDwellEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
