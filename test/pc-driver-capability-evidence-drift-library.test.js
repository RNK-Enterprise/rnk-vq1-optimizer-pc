import {
  DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_ID,
  DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_VERSION,
  buildDriverCapabilityEvidenceDriftEnvelope,
  buildDriverCapabilityEvidenceDriftPlan,
  createDriverCapabilityEvidenceDriftLibrary,
  mergeDriverCapabilityEvidenceDriftReports
} from '../pc/engines/driver-capability/turbos/evidence-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'driver-capability.evidence-drift', state: 'documented-drivers', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, driverCount: 2,
    unverifiedCount: 0, unknownCount: 0, observedCount: sampleCount,
    incompleteCount: 0, noDriverCount: 0, reviewSampleCount: 0,
    unverifiedSampleCount: 0, confidence: 1, ...overrides
  };
}

describe('driver-capability evidence-drift library', () => {
  test('publishes identity and merges driver evidence', () => {
    const merged = mergeDriverCapabilityEvidenceDriftReports([
      report({ sampleCount: 2, driverCount: 1, observedCount: 2 }),
      report({ state: 'unverified-sustained', sampleCount: 6, observedCount: 5,
        unverifiedCount: 1, unverifiedSampleCount: 3, reviewSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_ID).toBe('driver-capability.evidence-drift.library');
    expect(DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'unverified-sustained', sampleCount: 8,
      driverCount: 2, unverifiedCount: 1, observedCount: 7, unverifiedSampleCount: 3,
      reviewSampleCount: 3, confidence: 0.875,
      recommendations: ['review-driver-source-without-change'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeDriverCapabilityEvidenceDriftReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-driver-evidence']
    });
    expect(mergeDriverCapabilityEvidenceDriftReports([report({ state: 'no-drivers', sampleCount: 1,
      driverCount: 0, observedCount: 0, noDriverCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-drivers', recommendations: ['no-driver-capability-review']
    });
    expect(mergeDriverCapabilityEvidenceDriftReports([report({ state: 'incomplete-evidence',
      driverCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-environment-profile']
    });
    expect(mergeDriverCapabilityEvidenceDriftReports([report({ state: 'evidence-review-observed',
      reviewSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['request-driver-capability-observation']);
    expect(mergeDriverCapabilityEvidenceDriftReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeDriverCapabilityEvidenceDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      driverCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeDriverCapabilityEvidenceDriftReports([report({ state: 'insufficient-data', sampleCount: 0,
      driverCount: 0, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeDriverCapabilityEvidenceDriftReports([
      report({ state: 'unverified-sustained' }), report({ state: 'no-drivers', sampleCount: 1,
        driverCount: 0, observedCount: 0, noDriverCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-drivers' });
    const states = [
      ['unverified-sustained', 'driver-source-review', 750],
      ['evidence-review-observed', 'driver-evidence-observation', 1000],
      ['documented-drivers', 'documented-driver-observation', 5000],
      ['no-drivers', 'no-driver-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-drivers';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildDriverCapabilityEvidenceDriftPlan(report({ state, sampleCount,
        driverCount: empty ? 0 : 2, observedCount: empty ? 0 : sampleCount,
        noDriverCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildDriverCapabilityEvidenceDriftPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildDriverCapabilityEvidenceDriftPlan(report({ sampleCount: 0, driverCount: 0,
      observedCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildDriverCapabilityEvidenceDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createDriverCapabilityEvidenceDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, driverCount: 0,
      observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, ratios, triggers, and clocks', () => {
    expect(() => mergeDriverCapabilityEvidenceDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeDriverCapabilityEvidenceDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeDriverCapabilityEvidenceDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeDriverCapabilityEvidenceDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires an evidence-drift turbo report');
    expect(() => mergeDriverCapabilityEvidenceDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeDriverCapabilityEvidenceDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeDriverCapabilityEvidenceDriftReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeDriverCapabilityEvidenceDriftReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noDriverCount', 'reviewSampleCount', 'unverifiedSampleCount']) {
      expect(() => mergeDriverCapabilityEvidenceDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const field of ['unverifiedCount', 'unknownCount']) {
      expect(() => mergeDriverCapabilityEvidenceDriftReports([report({ [field]: 3 })]))
        .toThrow('must fit inside driverCount');
    }
    expect(() => mergeDriverCapabilityEvidenceDriftReports([report({ driverCount: 4097 })]))
      .toThrow('driverCount must be from 0 to 4096');
    expect(() => mergeDriverCapabilityEvidenceDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildDriverCapabilityEvidenceDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildDriverCapabilityEvidenceDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
