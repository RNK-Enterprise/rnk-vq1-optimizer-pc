import {
  NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_ID,
  NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_VERSION,
  buildNetworkObservationLinkHealthEnvelope,
  buildNetworkObservationLinkHealthPlan,
  createNetworkObservationLinkHealthLibrary,
  mergeNetworkObservationLinkHealthReports
} from '../pc/engines/network-observation/turbos/link-health/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'network-observation.link-health', state: 'stable-link-health', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, linkCount: 2,
    unknownStateCount: 0, stateChangeCount: 0, observedCount: sampleCount,
    incompleteCount: 0, noNetworkCount: 0, comparisonCount: sampleCount - 1,
    stateChangeSampleCount: 0, confidence: 1, ...overrides
  };
}

describe('network-observation link-health library', () => {
  test('publishes identity and merges link-state evidence', () => {
    const merged = mergeNetworkObservationLinkHealthReports([
      report({ sampleCount: 2, linkCount: 1, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'link-health-drift-sustained', sampleCount: 6, observedCount: 5,
        stateChangeCount: 1, comparisonCount: 5, stateChangeSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_ID).toBe('network-observation.link-health.library');
    expect(NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'link-health-drift-sustained', sampleCount: 8,
      linkCount: 2, unknownStateCount: 0, stateChangeCount: 1, observedCount: 7,
      comparisonCount: 6, stateChangeSampleCount: 3, confidence: 0.875,
      recommendations: ['review-link-state-drift-without-network-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeNetworkObservationLinkHealthReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-link-state-evidence']
    });
    expect(mergeNetworkObservationLinkHealthReports([report({ state: 'no-network', sampleCount: 1,
      linkCount: 0, unknownStateCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-network', recommendations: ['no-network-link-review']
    });
    expect(mergeNetworkObservationLinkHealthReports([report({ state: 'incomplete-evidence',
      linkCount: 0, unknownStateCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-link-state-evidence']
    });
    expect(mergeNetworkObservationLinkHealthReports([report({ state: 'link-health-drift-observed',
      stateChangeCount: 1, stateChangeSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['observe-link-state-stability']);
    expect(mergeNetworkObservationLinkHealthReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeNetworkObservationLinkHealthReports([report({ state: 'insufficient-data', sampleCount: 1,
      linkCount: 0, unknownStateCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeNetworkObservationLinkHealthReports([report({ state: 'insufficient-data', sampleCount: 0,
      linkCount: 0, unknownStateCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeNetworkObservationLinkHealthReports([
      report({ state: 'link-health-drift-sustained' }), report({ state: 'no-network', sampleCount: 1,
        linkCount: 0, unknownStateCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-network' });
    const states = [
      ['link-health-drift-sustained', 'link-state-review', 750],
      ['link-health-drift-observed', 'link-state-observation', 1000],
      ['stable-link-health', 'stable-link-state-observation', 5000],
      ['no-network', 'no-network-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-network';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildNetworkObservationLinkHealthPlan(report({ state, sampleCount,
        linkCount: empty ? 0 : 2, unknownStateCount: 0,
        observedCount: empty ? 0 : sampleCount, noNetworkCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildNetworkObservationLinkHealthPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildNetworkObservationLinkHealthPlan(report({ sampleCount: 0, linkCount: 0,
      unknownStateCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildNetworkObservationLinkHealthEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createNetworkObservationLinkHealthLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, linkCount: 0,
      unknownStateCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeNetworkObservationLinkHealthReports(null)).toThrow('reports must be an array');
    expect(() => mergeNetworkObservationLinkHealthReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeNetworkObservationLinkHealthReports([null])).toThrow('report must be an object');
    expect(() => mergeNetworkObservationLinkHealthReports([report({ turbo: 'other' })]))
      .toThrow('requires a link-health turbo report');
    expect(() => mergeNetworkObservationLinkHealthReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeNetworkObservationLinkHealthReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeNetworkObservationLinkHealthReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeNetworkObservationLinkHealthReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noNetworkCount', 'comparisonCount', 'stateChangeSampleCount']) {
      expect(() => mergeNetworkObservationLinkHealthReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeNetworkObservationLinkHealthReports([report({ linkCount: 4097 })]))
      .toThrow('linkCount must be from 0 to 4096');
    expect(() => mergeNetworkObservationLinkHealthReports([report({ unknownStateCount: 3 })]))
      .toThrow('unknownStateCount must fit inside linkCount');
    expect(() => mergeNetworkObservationLinkHealthReports([report({ stateChangeCount: 4097 })]))
      .toThrow('stateChangeCount must be from 0 to 4096');
    expect(() => mergeNetworkObservationLinkHealthReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildNetworkObservationLinkHealthEnvelope(report())).toThrow('trigger is required');
    expect(() => buildNetworkObservationLinkHealthEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
