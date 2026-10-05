import {
  SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_ID,
  SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_VERSION,
  buildSwapAccountingConsistencyEnvelope,
  buildSwapAccountingConsistencyPlan,
  createSwapAccountingConsistencyLibrary,
  mergeSwapAccountingConsistencyReports
} from '../pc/engines/swap/turbos/accounting-consistency/library.js';

function report(overrides = {}) {
  return {
    turbo: 'swap.accounting-consistency',
    state: 'accounting-consistent',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    noSwapCount: 0,
    consistentCount: 4,
    driftCount: 0,
    confidence: 1,
    ...overrides
  };
}

describe('Swap accounting-consistency library', () => {
  test('publishes identity and merges accounting evidence', () => {
    const merged = mergeSwapAccountingConsistencyReports([
      report({ sampleCount: 2, observedCount: 2, consistentCount: 2 }),
      report({ state: 'accounting-drift', sampleCount: 6, observedCount: 5,
        unknownCount: 1, consistentCount: 2, driftCount: 3, confidence: 0.8333 })
    ]);
    expect(SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_ID).toBe('swap.accounting-consistency.library');
    expect(SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'accounting-drift',
      sampleCount: 8, observedCount: 7, unknownCount: 1, consistentCount: 4,
      driftCount: 3, confidence: 0.875,
      recommendations: ['hold-swap-policy-automation', 'review-sensor-agreement'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeSwapAccountingConsistencyReports([])).toMatchObject({ state: 'insufficient-data',
      reportCount: 0, confidence: 0, recommendations: ['collect-more-swap-accounting-samples'] });
    expect(mergeSwapAccountingConsistencyReports([report({ state: 'no-swap', sampleCount: 0,
      observedCount: 0, unknownCount: 0, noSwapCount: 0, consistentCount: 0, driftCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-swap', confidence: 0, recommendations: ['no-change', 'keep-no-swap-user-owned'] });
    expect(mergeSwapAccountingConsistencyReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, consistentCount: 0, driftCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-observation', recommendations: ['request-swap-accounting-observation'] });
    expect(mergeSwapAccountingConsistencyReports([report({ state: 'invalid-accounting-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-accounting-evidence', recommendations: ['review-swap-accounting-sensors'] });
    expect(mergeSwapAccountingConsistencyReports([report({ state: 'accounting-consistent' })]))
      .toMatchObject({ state: 'accounting-consistent', recommendations: ['no-change'] });
    expect(mergeSwapAccountingConsistencyReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, consistentCount: 0, driftCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'insufficient-data' });
    expect(mergeSwapAccountingConsistencyReports([
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0, unknownCount: 0,
        consistentCount: 0, driftCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1,
        consistentCount: 0, driftCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies precedence and builds every state plan', () => {
    expect(mergeSwapAccountingConsistencyReports([
      report({ state: 'accounting-drift', driftCount: 1 }),
      report({ state: 'invalid-accounting-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-accounting-evidence' });
    const states = [
      ['invalid-accounting-evidence', 'sensor-review', 500],
      ['accounting-drift', 'sensor-agreement-review', 750],
      ['no-swap', 'no-swap-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['accounting-consistent', 'accounting-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildSwapAccountingConsistencyPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildSwapAccountingConsistencyPlan(report({ state: 'accounting-consistent' }), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildSwapAccountingConsistencyPlan(report({ state: 'accounting-consistent', sampleCount: 0,
      observedCount: 0, unknownCount: 0, consistentCount: 0, driftCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildSwapAccountingConsistencyEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createSwapAccountingConsistencyLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, consistentCount: 0, driftCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeSwapAccountingConsistencyReports(null)).toThrow('reports must be an array');
    expect(() => mergeSwapAccountingConsistencyReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeSwapAccountingConsistencyReports([null])).toThrow('report must be an object');
    expect(() => mergeSwapAccountingConsistencyReports([[]])).toThrow('report must be an object');
    expect(() => mergeSwapAccountingConsistencyReports([report({ turbo: 'other' })]))
      .toThrow('requires an accounting-consistency turbo report');
    expect(() => mergeSwapAccountingConsistencyReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeSwapAccountingConsistencyReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'noSwapCount',
      'consistentCount', 'driftCount']) {
      expect(() => mergeSwapAccountingConsistencyReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeSwapAccountingConsistencyReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeSwapAccountingConsistencyReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildSwapAccountingConsistencyEnvelope(report())).toThrow('trigger is required');
    expect(() => buildSwapAccountingConsistencyEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildSwapAccountingConsistencyEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildSwapAccountingConsistencyEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
