import {
  MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_ID,
  MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_VERSION,
  buildMemoryPolicyPressureDriftEnvelope,
  buildMemoryPolicyPressureDriftPlan,
  createMemoryPolicyPressureDriftLibrary,
  mergeMemoryPolicyPressureDriftReports
} from '../pc/engines/memory-policy/turbos/pressure-policy-drift/library.js';

function report(overrides = {}) {
  return {
    turbo: 'memory-policy.pressure-policy-drift',
    state: 'stable-policy',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    policyChanges: 0,
    escalationCount: 0,
    recoveryCount: 0,
    comparisonCount: 3,
    confidence: 1,
    ...overrides
  };
}

describe('Memory-policy pressure-policy-drift library', () => {
  test('publishes identity and merges drift evidence', () => {
    const merged = mergeMemoryPolicyPressureDriftReports([
      report({ sampleCount: 2, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'policy-escalation', sampleCount: 6, observedCount: 5,
        unknownCount: 1, policyChanges: 2, escalationCount: 2,
        comparisonCount: 5, confidence: 0.8333 })
    ]);
    expect(MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_ID)
      .toBe('memory-policy.pressure-policy-drift.library');
    expect(MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'policy-escalation',
      sampleCount: 8, observedCount: 7, unknownCount: 1, policyChanges: 2,
      escalationCount: 2, comparisonCount: 6, confidence: 0.875,
      recommendations: ['review-memory-pressure-escalation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeMemoryPolicyPressureDriftReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      recommendations: ['collect-more-policy-samples']
    });
    expect(mergeMemoryPolicyPressureDriftReports([report({ state: 'no-observation',
      sampleCount: 0, observedCount: 0, unknownCount: 0, comparisonCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-observation', confidence: 0,
        recommendations: ['request-memory-policy-observation'] });
    expect(mergeMemoryPolicyPressureDriftReports([report({ state: 'invalid-policy-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-policy-evidence', recommendations: ['review-memory-policy-sensor-range'] });
    expect(mergeMemoryPolicyPressureDriftReports([report({ state: 'policy-churn', policyChanges: 2 })]))
      .toMatchObject({ state: 'policy-churn', recommendations: ['hold-policy-automation', 'review-policy-transitions'] });
    expect(mergeMemoryPolicyPressureDriftReports([report({ state: 'policy-recovery', recoveryCount: 2 })]))
      .toMatchObject({ state: 'policy-recovery', recommendations: ['observe-memory-policy-recovery'] });
    expect(mergeMemoryPolicyPressureDriftReports([report({ state: 'stable-policy' })]))
      .toMatchObject({ state: 'stable-policy', recommendations: ['no-change'] });
    expect(mergeMemoryPolicyPressureDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, comparisonCount: 0, confidence: 0 })])
    ).toMatchObject({ state: 'insufficient-data' });
    expect(mergeMemoryPolicyPressureDriftReports([
      report({ state: 'no-observation' }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0,
        unknownCount: 1, comparisonCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies precedence and builds every state plan', () => {
    expect(mergeMemoryPolicyPressureDriftReports([
      report({ state: 'policy-churn', policyChanges: 2 }),
      report({ state: 'invalid-policy-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-policy-evidence' });
    expect(mergeMemoryPolicyPressureDriftReports([
      report({ state: 'policy-escalation', escalationCount: 2 }),
      report({ state: 'policy-churn', policyChanges: 2 })
    ])).toMatchObject({ state: 'policy-churn' });
    expect(mergeMemoryPolicyPressureDriftReports([
      report({ state: 'policy-recovery', recoveryCount: 2 }),
      report({ state: 'policy-escalation', escalationCount: 2 })
    ])).toMatchObject({ state: 'policy-escalation' });

    const states = [
      ['invalid-policy-evidence', 'sensor-review', 500],
      ['policy-churn', 'transition-review', 750],
      ['policy-escalation', 'escalation-observation', 1000],
      ['policy-recovery', 'recovery-observation', 1500],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['stable-policy', 'stable-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildMemoryPolicyPressureDriftPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildMemoryPolicyPressureDriftPlan(report({ state: 'stable-policy' }), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildMemoryPolicyPressureDriftPlan(report({ state: 'stable-policy', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildMemoryPolicyPressureDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createMemoryPolicyPressureDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, comparisonCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeMemoryPolicyPressureDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeMemoryPolicyPressureDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeMemoryPolicyPressureDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeMemoryPolicyPressureDriftReports([[]])).toThrow('report must be an object');
    expect(() => mergeMemoryPolicyPressureDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires a pressure-policy-drift turbo report');
    expect(() => mergeMemoryPolicyPressureDriftReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeMemoryPolicyPressureDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'policyChanges',
      'escalationCount', 'recoveryCount', 'comparisonCount']) {
      expect(() => mergeMemoryPolicyPressureDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeMemoryPolicyPressureDriftReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeMemoryPolicyPressureDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildMemoryPolicyPressureDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildMemoryPolicyPressureDriftEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPolicyPressureDriftEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPolicyPressureDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
