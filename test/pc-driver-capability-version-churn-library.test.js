import {
  DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_ID,
  DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_VERSION,
  buildDriverCapabilityVersionChurnEnvelope,
  buildDriverCapabilityVersionChurnPlan,
  createDriverCapabilityVersionChurnLibrary,
  mergeDriverCapabilityVersionChurnReports
} from '../pc/engines/driver-capability/turbos/version-churn/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'driver-capability.version-churn', state: 'stable-versions', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, driverCount: 2,
    versionChangeCount: 0, observedCount: sampleCount, incompleteCount: 0,
    noDriverCount: 0, comparisonCount: sampleCount - 1,
    versionChangeSampleCount: 0, confidence: 1, ...overrides
  };
}

describe('driver-capability version-churn library', () => {
  test('publishes identity and merges version evidence', () => {
    const merged = mergeDriverCapabilityVersionChurnReports([
      report({ sampleCount: 2, driverCount: 1, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'version-churn-sustained', sampleCount: 6, observedCount: 5,
        versionChangeCount: 1, comparisonCount: 5, versionChangeSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_ID).toBe('driver-capability.version-churn.library');
    expect(DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'version-churn-sustained', sampleCount: 8,
      driverCount: 2, versionChangeCount: 1, observedCount: 7, comparisonCount: 6,
      versionChangeSampleCount: 3, confidence: 0.875,
      recommendations: ['review-driver-version-churn-without-change'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeDriverCapabilityVersionChurnReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-driver-versions']
    });
    expect(mergeDriverCapabilityVersionChurnReports([report({ state: 'no-drivers', sampleCount: 1,
      driverCount: 0, versionChangeCount: 0, observedCount: 0, noDriverCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-drivers', recommendations: ['no-driver-version-review']
    });
    expect(mergeDriverCapabilityVersionChurnReports([report({ state: 'incomplete-evidence',
      driverCount: 0, versionChangeCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-driver-version-evidence']
    });
    expect(mergeDriverCapabilityVersionChurnReports([report({ state: 'version-churn-observed',
      versionChangeCount: 1, versionChangeSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['observe-driver-version-stability']);
    expect(mergeDriverCapabilityVersionChurnReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeDriverCapabilityVersionChurnReports([report({ state: 'insufficient-data', sampleCount: 1,
      driverCount: 0, versionChangeCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeDriverCapabilityVersionChurnReports([report({ state: 'insufficient-data', sampleCount: 0,
      driverCount: 0, versionChangeCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeDriverCapabilityVersionChurnReports([
      report({ state: 'version-churn-sustained' }), report({ state: 'no-drivers', sampleCount: 1,
        driverCount: 0, versionChangeCount: 0, observedCount: 0, noDriverCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-drivers' });
    const states = [
      ['version-churn-sustained', 'driver-version-review', 750],
      ['version-churn-observed', 'driver-version-observation', 1000],
      ['stable-versions', 'stable-driver-version-observation', 5000],
      ['no-drivers', 'no-driver-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-drivers';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildDriverCapabilityVersionChurnPlan(report({ state, sampleCount,
        driverCount: empty ? 0 : 2, versionChangeCount: 0,
        observedCount: empty ? 0 : sampleCount, noDriverCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildDriverCapabilityVersionChurnPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildDriverCapabilityVersionChurnPlan(report({ sampleCount: 0, driverCount: 0,
      versionChangeCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildDriverCapabilityVersionChurnEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createDriverCapabilityVersionChurnLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, driverCount: 0,
      versionChangeCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeDriverCapabilityVersionChurnReports(null)).toThrow('reports must be an array');
    expect(() => mergeDriverCapabilityVersionChurnReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeDriverCapabilityVersionChurnReports([null])).toThrow('report must be an object');
    expect(() => mergeDriverCapabilityVersionChurnReports([report({ turbo: 'other' })]))
      .toThrow('requires a version-churn turbo report');
    expect(() => mergeDriverCapabilityVersionChurnReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeDriverCapabilityVersionChurnReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeDriverCapabilityVersionChurnReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeDriverCapabilityVersionChurnReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noDriverCount', 'comparisonCount', 'versionChangeSampleCount']) {
      expect(() => mergeDriverCapabilityVersionChurnReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeDriverCapabilityVersionChurnReports([report({ driverCount: 4097 })]))
      .toThrow('driverCount must be from 0 to 4096');
    expect(() => mergeDriverCapabilityVersionChurnReports([report({ versionChangeCount: 3 })]))
      .toThrow('versionChangeCount must fit inside driverCount');
    expect(() => mergeDriverCapabilityVersionChurnReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildDriverCapabilityVersionChurnEnvelope(report())).toThrow('trigger is required');
    expect(() => buildDriverCapabilityVersionChurnEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
