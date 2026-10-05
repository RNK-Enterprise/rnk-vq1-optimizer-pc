import {
  MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_ID,
  MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_VERSION,
  buildMemoryPolicyHeadlessPostureEnvelope,
  buildMemoryPolicyHeadlessPosturePlan,
  createMemoryPolicyHeadlessPostureLibrary,
  mergeMemoryPolicyHeadlessPostureReports
} from '../pc/engines/memory-policy/turbos/headless-posture/library.js';

function report(overrides = {}) {
  return {
    turbo: 'memory-policy.headless-posture',
    state: 'aligned-posture',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    headlessGapCount: 0,
    interactiveGapCount: 0,
    unknownEnvironmentCount: 0,
    confidence: 1,
    ...overrides
  };
}

describe('Memory-policy headless-posture library', () => {
  test('publishes identity and merges posture evidence', () => {
    const merged = mergeMemoryPolicyHeadlessPostureReports([
      report({ sampleCount: 2, observedCount: 2 }),
      report({ state: 'headless-protection-gap', sampleCount: 6, observedCount: 5,
        unknownCount: 1, headlessGapCount: 2, confidence: 0.8333 })
    ]);
    expect(MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_ID)
      .toBe('memory-policy.headless-posture.library');
    expect(MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'headless-protection-gap',
      sampleCount: 8, observedCount: 7, unknownCount: 1, headlessGapCount: 2,
      confidence: 0.875, recommendations: ['hold-headless-policy-automation', 'review-service-protection'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeMemoryPolicyHeadlessPostureReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      recommendations: ['collect-more-posture-samples']
    });
    expect(mergeMemoryPolicyHeadlessPostureReports([report({ state: 'no-observation',
      sampleCount: 0, observedCount: 0, unknownCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-observation', confidence: 0,
        recommendations: ['request-memory-policy-observation'] });
    expect(mergeMemoryPolicyHeadlessPostureReports([report({ state: 'invalid-posture-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-posture-evidence', recommendations: ['review-memory-policy-sensor-range'] });
    expect(mergeMemoryPolicyHeadlessPostureReports([report({ state: 'interactive-policy-gap', interactiveGapCount: 1 })]))
      .toMatchObject({ state: 'interactive-policy-gap', recommendations: ['review-interactive-memory-policy'] });
    expect(mergeMemoryPolicyHeadlessPostureReports([report({ state: 'profile-required', unknownEnvironmentCount: 1 })]))
      .toMatchObject({ state: 'profile-required', recommendations: ['request-environment-profile'] });
    expect(mergeMemoryPolicyHeadlessPostureReports([report({ state: 'aligned-posture' })]))
      .toMatchObject({ state: 'aligned-posture', recommendations: ['no-change'] });
    expect(mergeMemoryPolicyHeadlessPostureReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeMemoryPolicyHeadlessPostureReports([
      report({ state: 'no-observation' }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies precedence and builds every state plan', () => {
    expect(mergeMemoryPolicyHeadlessPostureReports([
      report({ state: 'headless-protection-gap', headlessGapCount: 1 }),
      report({ state: 'invalid-posture-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-posture-evidence' });
    expect(mergeMemoryPolicyHeadlessPostureReports([
      report({ state: 'interactive-policy-gap', interactiveGapCount: 1 }),
      report({ state: 'headless-protection-gap', headlessGapCount: 1 })
    ])).toMatchObject({ state: 'headless-protection-gap' });
    expect(mergeMemoryPolicyHeadlessPostureReports([
      report({ state: 'profile-required', unknownEnvironmentCount: 1 }),
      report({ state: 'interactive-policy-gap', interactiveGapCount: 1 })
    ])).toMatchObject({ state: 'interactive-policy-gap' });

    const states = [
      ['invalid-posture-evidence', 'sensor-review', 500],
      ['headless-protection-gap', 'headless-protection-review', 750],
      ['interactive-policy-gap', 'interactive-policy-review', 1000],
      ['profile-required', 'environment-profile', 2000],
      ['no-observation', 'observation-bootstrap', 2500],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['aligned-posture', 'posture-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildMemoryPolicyHeadlessPosturePlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildMemoryPolicyHeadlessPosturePlan(report({ state: 'aligned-posture' }), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildMemoryPolicyHeadlessPosturePlan(report({ state: 'aligned-posture', sampleCount: 0,
      observedCount: 0, unknownCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildMemoryPolicyHeadlessPostureEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createMemoryPolicyHeadlessPostureLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeMemoryPolicyHeadlessPostureReports(null)).toThrow('reports must be an array');
    expect(() => mergeMemoryPolicyHeadlessPostureReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeMemoryPolicyHeadlessPostureReports([null])).toThrow('report must be an object');
    expect(() => mergeMemoryPolicyHeadlessPostureReports([[]])).toThrow('report must be an object');
    expect(() => mergeMemoryPolicyHeadlessPostureReports([report({ turbo: 'other' })]))
      .toThrow('requires a headless-posture turbo report');
    expect(() => mergeMemoryPolicyHeadlessPostureReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeMemoryPolicyHeadlessPostureReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'headlessGapCount',
      'interactiveGapCount', 'unknownEnvironmentCount']) {
      expect(() => mergeMemoryPolicyHeadlessPostureReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeMemoryPolicyHeadlessPostureReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeMemoryPolicyHeadlessPostureReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildMemoryPolicyHeadlessPostureEnvelope(report())).toThrow('trigger is required');
    expect(() => buildMemoryPolicyHeadlessPostureEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPolicyHeadlessPostureEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildMemoryPolicyHeadlessPostureEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
