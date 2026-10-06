import {
  NETWORK_SAFETY_TRUST_DRIFT_LIBRARY_ID,
  NETWORK_SAFETY_TRUST_DRIFT_LIBRARY_VERSION,
  buildNetworkSafetyTrustDriftEnvelope,
  buildNetworkSafetyTrustDriftPlan,
  createNetworkSafetyTrustDriftLibrary,
  mergeNetworkSafetyTrustDriftReports
} from '../pc/engines/network-safety/turbos/trust-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'network-safety.trust-drift', state: 'stable-trust', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, linkCount: 2,
    trustedCount: 2, unknownTrustCount: 0, trustChangeCount: 0,
    observedCount: sampleCount, incompleteCount: 0, noNetworkCount: 0,
    comparisonCount: sampleCount - 1, trustChangeSampleCount: 0,
    confidence: 1, ...overrides
  };
}

describe('network-safety trust-drift library', () => {
  test('publishes identity and merges trust evidence', () => {
    const merged = mergeNetworkSafetyTrustDriftReports([
      report({ sampleCount: 2, linkCount: 1, trustedCount: 1, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'trust-drift-sustained', sampleCount: 6, observedCount: 5,
        trustedCount: 1, trustChangeCount: 1, comparisonCount: 5,
        trustChangeSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(NETWORK_SAFETY_TRUST_DRIFT_LIBRARY_ID).toBe('network-safety.trust-drift.library');
    expect(NETWORK_SAFETY_TRUST_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'trust-drift-sustained', sampleCount: 8,
      linkCount: 2, trustedCount: 1, unknownTrustCount: 0, trustChangeCount: 1,
      observedCount: 7, comparisonCount: 6, trustChangeSampleCount: 3, confidence: 0.875,
      recommendations: ['review-trust-drift-without-network-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeNetworkSafetyTrustDriftReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-trust-evidence']
    });
    expect(mergeNetworkSafetyTrustDriftReports([report({ state: 'no-network', sampleCount: 1,
      linkCount: 0, trustedCount: 0, unknownTrustCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-network', recommendations: ['no-network-trust-review']
    });
    expect(mergeNetworkSafetyTrustDriftReports([report({ state: 'incomplete-evidence',
      linkCount: 0, trustedCount: 0, unknownTrustCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-explicit-trust-evidence']
    });
    expect(mergeNetworkSafetyTrustDriftReports([report({ state: 'trust-drift-observed',
      trustChangeCount: 1, trustChangeSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['observe-trust-stability']);
    expect(mergeNetworkSafetyTrustDriftReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeNetworkSafetyTrustDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      linkCount: 0, trustedCount: 0, unknownTrustCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeNetworkSafetyTrustDriftReports([report({ state: 'insufficient-data', sampleCount: 0,
      linkCount: 0, trustedCount: 0, unknownTrustCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeNetworkSafetyTrustDriftReports([
      report({ state: 'trust-drift-sustained' }), report({ state: 'no-network', sampleCount: 1,
        linkCount: 0, trustedCount: 0, unknownTrustCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-network' });
    const states = [
      ['trust-drift-sustained', 'trust-review', 750],
      ['trust-drift-observed', 'trust-observation', 1000],
      ['stable-trust', 'stable-trust-observation', 5000],
      ['no-network', 'no-network-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-network';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildNetworkSafetyTrustDriftPlan(report({ state, sampleCount,
        linkCount: empty ? 0 : 2, trustedCount: empty ? 0 : 2, unknownTrustCount: 0,
        observedCount: empty ? 0 : sampleCount, noNetworkCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildNetworkSafetyTrustDriftPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildNetworkSafetyTrustDriftPlan(report({ sampleCount: 0, linkCount: 0,
      trustedCount: 0, unknownTrustCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildNetworkSafetyTrustDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: NETWORK_SAFETY_TRUST_DRIFT_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createNetworkSafetyTrustDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(NETWORK_SAFETY_TRUST_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, linkCount: 0,
      trustedCount: 0, unknownTrustCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeNetworkSafetyTrustDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeNetworkSafetyTrustDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeNetworkSafetyTrustDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeNetworkSafetyTrustDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires a trust-drift turbo report');
    expect(() => mergeNetworkSafetyTrustDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeNetworkSafetyTrustDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeNetworkSafetyTrustDriftReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeNetworkSafetyTrustDriftReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noNetworkCount', 'comparisonCount', 'trustChangeSampleCount']) {
      expect(() => mergeNetworkSafetyTrustDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const field of ['trustedCount', 'unknownTrustCount']) {
      expect(() => mergeNetworkSafetyTrustDriftReports([report({ [field]: 3 })]))
        .toThrow('must fit inside linkCount');
    }
    expect(() => mergeNetworkSafetyTrustDriftReports([report({ linkCount: 4097 })]))
      .toThrow('linkCount must be from 0 to 4096');
    expect(() => mergeNetworkSafetyTrustDriftReports([report({ trustChangeCount: 4097 })]))
      .toThrow('trustChangeCount must be from 0 to 4096');
    expect(() => mergeNetworkSafetyTrustDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildNetworkSafetyTrustDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildNetworkSafetyTrustDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
