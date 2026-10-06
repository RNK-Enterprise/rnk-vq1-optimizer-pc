import {
  DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_ID,
  DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_VERSION,
  buildDriverCapabilityIdentityCompletenessEnvelope,
  buildDriverCapabilityIdentityCompletenessPlan,
  createDriverCapabilityIdentityCompletenessLibrary,
  mergeDriverCapabilityIdentityCompletenessReports
} from '../pc/engines/driver-capability/turbos/identity-completeness/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'driver-capability.identity-completeness', state: 'complete-identity', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, driverCount: 2,
    completeCount: 2, incompleteRowCount: 0, missingFieldCount: 0,
    observedCount: sampleCount, incompleteCount: 0, noDriverCount: 0,
    gapSampleCount: 0, sustainedGapCount: 0, confidence: 1, ...overrides
  };
}

describe('driver-capability identity-completeness library', () => {
  test('publishes identity and merges completeness evidence', () => {
    const merged = mergeDriverCapabilityIdentityCompletenessReports([
      report({ sampleCount: 2, driverCount: 1, completeCount: 1, observedCount: 2 }),
      report({ state: 'identity-gap-sustained', sampleCount: 6, observedCount: 5,
        completeCount: 1, incompleteRowCount: 1, missingFieldCount: 2,
        gapSampleCount: 3, sustainedGapCount: 3, confidence: 0.8333 })
    ]);
    expect(DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_ID)
      .toBe('driver-capability.identity-completeness.library');
    expect(DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'identity-gap-sustained', sampleCount: 8,
      driverCount: 2, completeCount: 1, incompleteRowCount: 1, missingFieldCount: 2,
      observedCount: 7, gapSampleCount: 3, sustainedGapCount: 3, confidence: 0.875,
      recommendations: ['review-driver-identity-source-without-change'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeDriverCapabilityIdentityCompletenessReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-driver-identity']
    });
    expect(mergeDriverCapabilityIdentityCompletenessReports([report({ state: 'no-drivers', sampleCount: 1,
      driverCount: 0, completeCount: 0, observedCount: 0, noDriverCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-drivers', recommendations: ['no-driver-identity-review']
    });
    expect(mergeDriverCapabilityIdentityCompletenessReports([report({ state: 'incomplete-evidence',
      driverCount: 0, completeCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-environment-profile']
    });
    expect(mergeDriverCapabilityIdentityCompletenessReports([report({ state: 'identity-gap-observed',
      incompleteRowCount: 1, missingFieldCount: 1, gapSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['request-driver-identity-observation']);
    expect(mergeDriverCapabilityIdentityCompletenessReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeDriverCapabilityIdentityCompletenessReports([report({ state: 'insufficient-data', sampleCount: 1,
      driverCount: 0, completeCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeDriverCapabilityIdentityCompletenessReports([report({ state: 'insufficient-data', sampleCount: 0,
      driverCount: 0, completeCount: 0, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeDriverCapabilityIdentityCompletenessReports([
      report({ state: 'identity-gap-sustained' }), report({ state: 'no-drivers', sampleCount: 1,
        driverCount: 0, completeCount: 0, observedCount: 0, noDriverCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-drivers' });
    const states = [
      ['identity-gap-sustained', 'driver-identity-review', 750],
      ['identity-gap-observed', 'driver-identity-observation', 1000],
      ['complete-identity', 'complete-identity-observation', 5000],
      ['no-drivers', 'no-driver-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-drivers';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildDriverCapabilityIdentityCompletenessPlan(report({ state, sampleCount,
        driverCount: empty ? 0 : 2, completeCount: empty ? 0 : 2,
        incompleteRowCount: 0, observedCount: empty ? 0 : sampleCount,
        noDriverCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildDriverCapabilityIdentityCompletenessPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildDriverCapabilityIdentityCompletenessPlan(report({ sampleCount: 0, driverCount: 0,
      completeCount: 0, observedCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildDriverCapabilityIdentityCompletenessEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createDriverCapabilityIdentityCompletenessLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, driverCount: 0,
      completeCount: 0, observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeDriverCapabilityIdentityCompletenessReports(null)).toThrow('reports must be an array');
    expect(() => mergeDriverCapabilityIdentityCompletenessReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeDriverCapabilityIdentityCompletenessReports([null])).toThrow('report must be an object');
    expect(() => mergeDriverCapabilityIdentityCompletenessReports([report({ turbo: 'other' })]))
      .toThrow('requires an identity-completeness turbo report');
    expect(() => mergeDriverCapabilityIdentityCompletenessReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeDriverCapabilityIdentityCompletenessReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeDriverCapabilityIdentityCompletenessReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeDriverCapabilityIdentityCompletenessReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noDriverCount', 'gapSampleCount', 'sustainedGapCount']) {
      expect(() => mergeDriverCapabilityIdentityCompletenessReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const field of ['completeCount', 'incompleteRowCount']) {
      expect(() => mergeDriverCapabilityIdentityCompletenessReports([report({ [field]: 3 })]))
        .toThrow('must fit inside driverCount');
    }
    expect(() => mergeDriverCapabilityIdentityCompletenessReports([report({ driverCount: 4097 })]))
      .toThrow('driverCount must be from 0 to 4096');
    expect(() => mergeDriverCapabilityIdentityCompletenessReports([report({ missingFieldCount: 9 })]))
      .toThrow('missingFieldCount must fit inside driver identity fields');
    expect(() => mergeDriverCapabilityIdentityCompletenessReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildDriverCapabilityIdentityCompletenessEnvelope(report())).toThrow('trigger is required');
    expect(() => buildDriverCapabilityIdentityCompletenessEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
