import {
  MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_ID,
  MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_VERSION,
  buildMemoryPolicyConsentBoundaryEnvelope,
  buildMemoryPolicyConsentBoundaryPlan,
  createMemoryPolicyConsentBoundaryLibrary,
  mergeMemoryPolicyConsentBoundaryReports
} from '../pc/engines/memory-policy/turbos/consent-boundary/library.js';

function report(overrides = {}) {
  return {
    turbo: 'memory-policy.consent-boundary',
    state: 'consent-aligned',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    blockedCount: 0,
    consentGapCount: 0,
    requestCount: 2,
    confidence: 1,
    ...overrides
  };
}

describe('Memory-policy consent-boundary library', () => {
  test('publishes identity and merges consent evidence', () => {
    const merged = mergeMemoryPolicyConsentBoundaryReports([
      report({ sampleCount: 2, observedCount: 2, requestCount: 1 }),
      report({ state: 'consent-required', sampleCount: 6, observedCount: 5,
        unknownCount: 1, consentGapCount: 2, requestCount: 3, confidence: 0.8333 })
    ]);
    expect(MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_ID)
      .toBe('memory-policy.consent-boundary.library');
    expect(MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'consent-required',
      sampleCount: 8, observedCount: 7, unknownCount: 1, consentGapCount: 2,
      requestCount: 4, confidence: 0.875,
      recommendations: ['require-explicit-consent', 'hold-policy-automation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeMemoryPolicyConsentBoundaryReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      recommendations: ['collect-more-consent-samples']
    });
    expect(mergeMemoryPolicyConsentBoundaryReports([report({ state: 'no-observation',
      sampleCount: 0, observedCount: 0, unknownCount: 0, requestCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-observation', confidence: 0,
        recommendations: ['request-policy-consent-observation'] });
    expect(mergeMemoryPolicyConsentBoundaryReports([report({ state: 'invalid-consent-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-consent-evidence', recommendations: ['review-policy-consent-input'] });
    expect(mergeMemoryPolicyConsentBoundaryReports([report({ state: 'destructive-blocked', blockedCount: 1 })]))
      .toMatchObject({ state: 'destructive-blocked', recommendations: ['hold-destructive-actions', 'require-explicit-consent'] });
    expect(mergeMemoryPolicyConsentBoundaryReports([report({ state: 'no-policy-request', requestCount: 0 })]))
      .toMatchObject({ state: 'no-policy-request', recommendations: ['no-policy-change-request'] });
    expect(mergeMemoryPolicyConsentBoundaryReports([report({ state: 'consent-aligned' })]))
      .toMatchObject({ state: 'consent-aligned', recommendations: ['no-change'] });
    expect(mergeMemoryPolicyConsentBoundaryReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, requestCount: 0, confidence: 0 })])
    ).toMatchObject({ state: 'insufficient-data' });
    expect(mergeMemoryPolicyConsentBoundaryReports([
      report({ state: 'no-observation' }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0,
        unknownCount: 1, requestCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies precedence and builds every state plan', () => {
    expect(mergeMemoryPolicyConsentBoundaryReports([
      report({ state: 'destructive-blocked', blockedCount: 1 }),
      report({ state: 'invalid-consent-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-consent-evidence' });
    expect(mergeMemoryPolicyConsentBoundaryReports([
      report({ state: 'consent-required', consentGapCount: 1 }),
      report({ state: 'destructive-blocked', blockedCount: 1 })
    ])).toMatchObject({ state: 'destructive-blocked' });
    expect(mergeMemoryPolicyConsentBoundaryReports([
      report({ state: 'no-policy-request', requestCount: 0 }),
      report({ state: 'consent-required', consentGapCount: 1 })
    ])).toMatchObject({ state: 'consent-required' });

    const states = [
      ['invalid-consent-evidence', 'consent-input-review', 500],
      ['destructive-blocked', 'destructive-hold', 750],
      ['consent-required', 'consent-review', 1000],
      ['no-policy-request', 'request-review', 1500],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['consent-aligned', 'consent-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildMemoryPolicyConsentBoundaryPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildMemoryPolicyConsentBoundaryPlan(report({ state: 'consent-aligned' }), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildMemoryPolicyConsentBoundaryPlan(report({ state: 'consent-aligned', sampleCount: 0,
      observedCount: 0, unknownCount: 0, requestCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildMemoryPolicyConsentBoundaryEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createMemoryPolicyConsentBoundaryLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, requestCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeMemoryPolicyConsentBoundaryReports(null)).toThrow('reports must be an array');
    expect(() => mergeMemoryPolicyConsentBoundaryReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeMemoryPolicyConsentBoundaryReports([null])).toThrow('report must be an object');
    expect(() => mergeMemoryPolicyConsentBoundaryReports([[]])).toThrow('report must be an object');
    expect(() => mergeMemoryPolicyConsentBoundaryReports([report({ turbo: 'other' })]))
      .toThrow('requires a consent-boundary turbo report');
    expect(() => mergeMemoryPolicyConsentBoundaryReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeMemoryPolicyConsentBoundaryReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'blockedCount',
      'consentGapCount', 'requestCount']) {
      expect(() => mergeMemoryPolicyConsentBoundaryReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeMemoryPolicyConsentBoundaryReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeMemoryPolicyConsentBoundaryReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildMemoryPolicyConsentBoundaryEnvelope(report())).toThrow('trigger is required');
    expect(() => buildMemoryPolicyConsentBoundaryEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPolicyConsentBoundaryEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPolicyConsentBoundaryEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
