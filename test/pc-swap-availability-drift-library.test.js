import {
  SWAP_AVAILABILITY_DRIFT_LIBRARY_ID,
  SWAP_AVAILABILITY_DRIFT_LIBRARY_VERSION,
  buildSwapAvailabilityDriftEnvelope,
  buildSwapAvailabilityDriftPlan,
  createSwapAvailabilityDriftLibrary,
  mergeSwapAvailabilityDriftReports
} from '../pc/engines/swap/turbos/availability-drift/library.js';

function report(overrides = {}) {
  return {
    turbo: 'swap.availability-drift',
    state: 'stable-availability',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    noneCount: 0,
    increaseCount: 0,
    decreaseCount: 0,
    availabilityChanges: 0,
    comparisonCount: 3,
    confidence: 1,
    ...overrides
  };
}

describe('Swap availability-drift library', () => {
  test('publishes identity and merges capacity movement evidence', () => {
    const merged = mergeSwapAvailabilityDriftReports([
      report({ sampleCount: 2, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'availability-drift', sampleCount: 6, observedCount: 5,
        unknownCount: 1, noneCount: 1, increaseCount: 1, availabilityChanges: 1,
        comparisonCount: 5, confidence: 0.8333 })
    ]);
    expect(SWAP_AVAILABILITY_DRIFT_LIBRARY_ID).toBe('swap.availability-drift.library');
    expect(SWAP_AVAILABILITY_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'availability-drift',
      sampleCount: 8, observedCount: 7, unknownCount: 1, noneCount: 1,
      increaseCount: 1, availabilityChanges: 1, confidence: 0.875,
      recommendations: ['review-swap-availability-change', 'hold-automatic-creation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeSwapAvailabilityDriftReports([])).toMatchObject({ state: 'insufficient-data',
      reportCount: 0, confidence: 0, recommendations: ['collect-more-swap-availability-samples'] });
    expect(mergeSwapAvailabilityDriftReports([report({ state: 'no-swap', sampleCount: 0,
      observedCount: 0, unknownCount: 0, noneCount: 0, comparisonCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-swap', confidence: 0, recommendations: ['no-change', 'keep-no-swap-user-owned'] });
    expect(mergeSwapAvailabilityDriftReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-observation', recommendations: ['request-swap-availability-observation'] });
    expect(mergeSwapAvailabilityDriftReports([report({ state: 'invalid-availability-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-availability-evidence', recommendations: ['review-swap-capacity-sensor-range'] });
    expect(mergeSwapAvailabilityDriftReports([report({ state: 'capacity-loss', decreaseCount: 1 })]))
      .toMatchObject({ state: 'capacity-loss', recommendations: ['review-swap-capacity-loss'] });
    expect(mergeSwapAvailabilityDriftReports([report({ state: 'capacity-gain', increaseCount: 1 })]))
      .toMatchObject({ state: 'capacity-gain', recommendations: ['observe-new-swap-capacity'] });
    expect(mergeSwapAvailabilityDriftReports([report({ state: 'stable-availability' })]))
      .toMatchObject({ state: 'stable-availability', recommendations: ['no-change'] });
    expect(mergeSwapAvailabilityDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, comparisonCount: 0, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeSwapAvailabilityDriftReports([
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0, unknownCount: 0,
        comparisonCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1,
        comparisonCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies precedence and builds every state plan', () => {
    expect(mergeSwapAvailabilityDriftReports([
      report({ state: 'availability-drift', availabilityChanges: 1 }),
      report({ state: 'invalid-availability-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-availability-evidence' });
    expect(mergeSwapAvailabilityDriftReports([
      report({ state: 'capacity-loss', decreaseCount: 1 }),
      report({ state: 'availability-drift', availabilityChanges: 1 })
    ])).toMatchObject({ state: 'availability-drift' });

    const states = [
      ['invalid-availability-evidence', 'sensor-review', 500],
      ['availability-drift', 'availability-review', 750],
      ['capacity-loss', 'capacity-loss-review', 1000],
      ['capacity-gain', 'capacity-gain-observation', 1500],
      ['no-swap', 'no-swap-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['stable-availability', 'availability-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildSwapAvailabilityDriftPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildSwapAvailabilityDriftPlan(report({ state: 'stable-availability' }), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildSwapAvailabilityDriftPlan(report({ state: 'stable-availability', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildSwapAvailabilityDriftEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: SWAP_AVAILABILITY_DRIFT_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createSwapAvailabilityDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(SWAP_AVAILABILITY_DRIFT_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, comparisonCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeSwapAvailabilityDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeSwapAvailabilityDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeSwapAvailabilityDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeSwapAvailabilityDriftReports([[]])).toThrow('report must be an object');
    expect(() => mergeSwapAvailabilityDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires an availability-drift turbo report');
    expect(() => mergeSwapAvailabilityDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeSwapAvailabilityDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'noneCount',
      'increaseCount', 'decreaseCount', 'availabilityChanges', 'comparisonCount']) {
      expect(() => mergeSwapAvailabilityDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeSwapAvailabilityDriftReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeSwapAvailabilityDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildSwapAvailabilityDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildSwapAvailabilityDriftEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildSwapAvailabilityDriftEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildSwapAvailabilityDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
