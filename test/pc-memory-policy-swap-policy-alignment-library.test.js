import {
  MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_ID,
  MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_VERSION,
  buildMemoryPolicySwapPolicyAlignmentEnvelope,
  buildMemoryPolicySwapPolicyAlignmentPlan,
  createMemoryPolicySwapPolicyAlignmentLibrary,
  mergeMemoryPolicySwapPolicyAlignmentReports
} from '../pc/engines/memory-policy/turbos/swap-policy-alignment/library.js';

function report(overrides = {}) {
  return {
    turbo: 'memory-policy.swap-policy-alignment',
    state: 'aligned-swap-policy',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    swapObservedCount: 4,
    policyObservedCount: 4,
    mismatchCount: 0,
    criticalMismatchCount: 0,
    confidence: 1,
    ...overrides
  };
}

describe('Memory-policy swap-policy-alignment library', () => {
  test('publishes identity and merges swap alignment evidence', () => {
    const merged = mergeMemoryPolicySwapPolicyAlignmentReports([
      report({ sampleCount: 2, observedCount: 2, swapObservedCount: 2, policyObservedCount: 2 }),
      report({ state: 'swap-policy-gap', sampleCount: 6, observedCount: 5,
        unknownCount: 1, swapObservedCount: 5, policyObservedCount: 5,
        mismatchCount: 2, confidence: 0.8333 })
    ]);
    expect(MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_ID)
      .toBe('memory-policy.swap-policy-alignment.library');
    expect(MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'swap-policy-gap',
      sampleCount: 8, observedCount: 7, unknownCount: 1, mismatchCount: 2,
      confidence: 0.875, recommendations: ['review-swap-aware-memory-policy'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeMemoryPolicySwapPolicyAlignmentReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      recommendations: ['collect-more-swap-policy-samples']
    });
    expect(mergeMemoryPolicySwapPolicyAlignmentReports([report({ state: 'no-observation',
      sampleCount: 0, observedCount: 0, unknownCount: 0, swapObservedCount: 0,
      policyObservedCount: 0, confidence: 0 })])).toMatchObject({ state: 'no-observation', confidence: 0,
        recommendations: ['request-swap-observation'] });
    expect(mergeMemoryPolicySwapPolicyAlignmentReports([report({ state: 'invalid-swap-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-swap-evidence', recommendations: ['review-swap-sensor-range'] });
    expect(mergeMemoryPolicySwapPolicyAlignmentReports([report({ state: 'critical-swap-policy-gap',
      mismatchCount: 1, criticalMismatchCount: 1 })])).toMatchObject({ state: 'critical-swap-policy-gap',
        recommendations: ['hold-current-under-critical-swap', 'review-policy-consent'] });
    expect(mergeMemoryPolicySwapPolicyAlignmentReports([report({ state: 'swap-observation-required',
      observedCount: 1, swapObservedCount: 1, policyObservedCount: 1 })])).toMatchObject({
        state: 'swap-observation-required', recommendations: ['collect-complete-swap-window'] });
    expect(mergeMemoryPolicySwapPolicyAlignmentReports([report({ state: 'policy-observation-required',
      policyObservedCount: 0 })])).toMatchObject({ state: 'policy-observation-required',
        recommendations: ['request-memory-policy-observation'] });
    expect(mergeMemoryPolicySwapPolicyAlignmentReports([report({ state: 'aligned-swap-policy' })]))
      .toMatchObject({ state: 'aligned-swap-policy', recommendations: ['no-change'] });
    expect(mergeMemoryPolicySwapPolicyAlignmentReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, swapObservedCount: 0, policyObservedCount: 0, confidence: 0 })])
    ).toMatchObject({ state: 'insufficient-data' });
    expect(mergeMemoryPolicySwapPolicyAlignmentReports([
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0,
        unknownCount: 0, swapObservedCount: 0, policyObservedCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0,
        unknownCount: 1, swapObservedCount: 0, policyObservedCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies precedence and builds every state plan', () => {
    expect(mergeMemoryPolicySwapPolicyAlignmentReports([
      report({ state: 'critical-swap-policy-gap', mismatchCount: 1, criticalMismatchCount: 1 }),
      report({ state: 'invalid-swap-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-swap-evidence' });
    expect(mergeMemoryPolicySwapPolicyAlignmentReports([
      report({ state: 'swap-policy-gap', mismatchCount: 1 }),
      report({ state: 'critical-swap-policy-gap', mismatchCount: 1, criticalMismatchCount: 1 })
    ])).toMatchObject({ state: 'critical-swap-policy-gap' });
    expect(mergeMemoryPolicySwapPolicyAlignmentReports([
      report({ state: 'policy-observation-required', policyObservedCount: 0 }),
      report({ state: 'swap-observation-required', observedCount: 1, swapObservedCount: 1,
        policyObservedCount: 1 })
    ])).toMatchObject({ state: 'swap-observation-required' });

    const states = [
      ['invalid-swap-evidence', 'sensor-review', 500],
      ['critical-swap-policy-gap', 'critical-swap-review', 750],
      ['swap-policy-gap', 'swap-policy-review', 1000],
      ['swap-observation-required', 'swap-observation-bootstrap', 1800],
      ['policy-observation-required', 'policy-observation-bootstrap', 2200],
      ['no-observation', 'observation-bootstrap', 2500],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['aligned-swap-policy', 'swap-policy-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildMemoryPolicySwapPolicyAlignmentPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildMemoryPolicySwapPolicyAlignmentPlan(report({ state: 'aligned-swap-policy' }), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildMemoryPolicySwapPolicyAlignmentPlan(report({ state: 'aligned-swap-policy', sampleCount: 0,
      observedCount: 0, unknownCount: 0, swapObservedCount: 0, policyObservedCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildMemoryPolicySwapPolicyAlignmentEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createMemoryPolicySwapPolicyAlignmentLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, swapObservedCount: 0, policyObservedCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeMemoryPolicySwapPolicyAlignmentReports(null)).toThrow('reports must be an array');
    expect(() => mergeMemoryPolicySwapPolicyAlignmentReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeMemoryPolicySwapPolicyAlignmentReports([null])).toThrow('report must be an object');
    expect(() => mergeMemoryPolicySwapPolicyAlignmentReports([[]])).toThrow('report must be an object');
    expect(() => mergeMemoryPolicySwapPolicyAlignmentReports([report({ turbo: 'other' })]))
      .toThrow('requires a swap-policy-alignment turbo report');
    expect(() => mergeMemoryPolicySwapPolicyAlignmentReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeMemoryPolicySwapPolicyAlignmentReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'swapObservedCount',
      'policyObservedCount', 'mismatchCount', 'criticalMismatchCount']) {
      expect(() => mergeMemoryPolicySwapPolicyAlignmentReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeMemoryPolicySwapPolicyAlignmentReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeMemoryPolicySwapPolicyAlignmentReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildMemoryPolicySwapPolicyAlignmentEnvelope(report())).toThrow('trigger is required');
    expect(() => buildMemoryPolicySwapPolicyAlignmentEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPolicySwapPolicyAlignmentEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPolicySwapPolicyAlignmentEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
