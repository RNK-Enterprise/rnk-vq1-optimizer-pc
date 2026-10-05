import {
  SWAP_HEADROOM_COLLAPSE_LIBRARY_ID,
  SWAP_HEADROOM_COLLAPSE_LIBRARY_VERSION,
  buildSwapHeadroomCollapseEnvelope,
  buildSwapHeadroomCollapsePlan,
  createSwapHeadroomCollapseLibrary,
  mergeSwapHeadroomCollapseReports
} from '../pc/engines/swap/turbos/headroom-collapse/library.js';

function report(overrides = {}) {
  return {
    turbo: 'swap.headroom-collapse',
    state: 'stable-headroom',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    noSwapCount: 0,
    collapseCount: 0,
    recoveryCount: 0,
    comparisonCount: 3,
    confidence: 1,
    ...overrides
  };
}

describe('Swap headroom-collapse library', () => {
  test('publishes identity and merges headroom movement evidence', () => {
    const merged = mergeSwapHeadroomCollapseReports([
      report({ sampleCount: 2, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'headroom-collapse', sampleCount: 6, observedCount: 5,
        unknownCount: 1, collapseCount: 2, comparisonCount: 5, confidence: 0.8333 })
    ]);
    expect(SWAP_HEADROOM_COLLAPSE_LIBRARY_ID).toBe('swap.headroom-collapse.library');
    expect(SWAP_HEADROOM_COLLAPSE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'headroom-collapse',
      sampleCount: 8, observedCount: 7, unknownCount: 1, collapseCount: 2,
      comparisonCount: 6, confidence: 0.875,
      recommendations: ['hold-destructive-actions', 'observe-swap-headroom'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeSwapHeadroomCollapseReports([])).toMatchObject({ state: 'insufficient-data',
      reportCount: 0, confidence: 0, recommendations: ['collect-more-swap-headroom-samples'] });
    expect(mergeSwapHeadroomCollapseReports([report({ state: 'no-swap', sampleCount: 0,
      observedCount: 0, unknownCount: 0, noSwapCount: 0, comparisonCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-swap', confidence: 0, recommendations: ['no-change', 'keep-no-swap-user-owned'] });
    expect(mergeSwapHeadroomCollapseReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-observation', recommendations: ['request-swap-headroom-observation'] });
    expect(mergeSwapHeadroomCollapseReports([report({ state: 'invalid-headroom-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-headroom-evidence', recommendations: ['review-swap-capacity-sensor-range'] });
    expect(mergeSwapHeadroomCollapseReports([report({ state: 'headroom-recovery', recoveryCount: 1 })]))
      .toMatchObject({ state: 'headroom-recovery', recommendations: ['observe-swap-headroom-recovery'] });
    expect(mergeSwapHeadroomCollapseReports([report({ state: 'stable-headroom' })]))
      .toMatchObject({ state: 'stable-headroom', recommendations: ['no-change'] });
    expect(mergeSwapHeadroomCollapseReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, comparisonCount: 0, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeSwapHeadroomCollapseReports([
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0,
        unknownCount: 0, comparisonCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0,
        unknownCount: 1, comparisonCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies precedence and builds every state plan', () => {
    expect(mergeSwapHeadroomCollapseReports([
      report({ state: 'headroom-collapse', collapseCount: 1 }),
      report({ state: 'invalid-headroom-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-headroom-evidence' });
    expect(mergeSwapHeadroomCollapseReports([
      report({ state: 'headroom-recovery', recoveryCount: 1 }),
      report({ state: 'headroom-collapse', collapseCount: 1 })
    ])).toMatchObject({ state: 'headroom-collapse' });

    const states = [
      ['invalid-headroom-evidence', 'sensor-review', 500],
      ['headroom-collapse', 'headroom-protection', 750],
      ['headroom-recovery', 'recovery-observation', 1250],
      ['no-swap', 'no-swap-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['stable-headroom', 'stable-headroom-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildSwapHeadroomCollapsePlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildSwapHeadroomCollapsePlan(report({ state: 'stable-headroom' }), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildSwapHeadroomCollapsePlan(report({ state: 'stable-headroom', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildSwapHeadroomCollapseEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: SWAP_HEADROOM_COLLAPSE_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createSwapHeadroomCollapseLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(SWAP_HEADROOM_COLLAPSE_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, comparisonCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeSwapHeadroomCollapseReports(null)).toThrow('reports must be an array');
    expect(() => mergeSwapHeadroomCollapseReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeSwapHeadroomCollapseReports([null])).toThrow('report must be an object');
    expect(() => mergeSwapHeadroomCollapseReports([[]])).toThrow('report must be an object');
    expect(() => mergeSwapHeadroomCollapseReports([report({ turbo: 'other' })]))
      .toThrow('requires a headroom-collapse turbo report');
    expect(() => mergeSwapHeadroomCollapseReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeSwapHeadroomCollapseReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'noSwapCount',
      'collapseCount', 'recoveryCount', 'comparisonCount']) {
      expect(() => mergeSwapHeadroomCollapseReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeSwapHeadroomCollapseReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeSwapHeadroomCollapseReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildSwapHeadroomCollapseEnvelope(report())).toThrow('trigger is required');
    expect(() => buildSwapHeadroomCollapseEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildSwapHeadroomCollapseEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildSwapHeadroomCollapseEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
