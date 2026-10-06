import {
  NETWORK_OBSERVATION_ROUTE_STABILITY_LIBRARY_ID,
  NETWORK_OBSERVATION_ROUTE_STABILITY_LIBRARY_VERSION,
  buildNetworkObservationRouteStabilityEnvelope,
  buildNetworkObservationRouteStabilityPlan,
  createNetworkObservationRouteStabilityLibrary,
  mergeNetworkObservationRouteStabilityReports
} from '../pc/engines/network-observation/turbos/route-stability/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'network-observation.route-stability', state: 'stable-routes', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, linkCount: 2,
    defaultRouteCount: 1, routeChangeCount: 0, observedCount: sampleCount,
    incompleteCount: 0, noNetworkCount: 0, comparisonCount: sampleCount - 1,
    routeChangeSampleCount: 0, confidence: 1, ...overrides
  };
}

describe('network-observation route-stability library', () => {
  test('publishes identity and merges route evidence', () => {
    const merged = mergeNetworkObservationRouteStabilityReports([
      report({ sampleCount: 2, linkCount: 1, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'route-drift-sustained', sampleCount: 6, observedCount: 5,
        defaultRouteCount: 1, routeChangeCount: 1, comparisonCount: 5,
        routeChangeSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(NETWORK_OBSERVATION_ROUTE_STABILITY_LIBRARY_ID).toBe('network-observation.route-stability.library');
    expect(NETWORK_OBSERVATION_ROUTE_STABILITY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'route-drift-sustained', sampleCount: 8,
      linkCount: 2, defaultRouteCount: 1, routeChangeCount: 1, observedCount: 7,
      comparisonCount: 6, routeChangeSampleCount: 3, confidence: 0.875,
      recommendations: ['review-route-drift-without-network-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeNetworkObservationRouteStabilityReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-route-evidence']
    });
    expect(mergeNetworkObservationRouteStabilityReports([report({ state: 'no-network', sampleCount: 1,
      linkCount: 0, defaultRouteCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-network', recommendations: ['no-network-route-review']
    });
    expect(mergeNetworkObservationRouteStabilityReports([report({ state: 'incomplete-evidence',
      linkCount: 0, defaultRouteCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-network-environment-profile']
    });
    expect(mergeNetworkObservationRouteStabilityReports([report({ state: 'route-drift-observed',
      routeChangeCount: 1, routeChangeSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['observe-route-stability']);
    expect(mergeNetworkObservationRouteStabilityReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeNetworkObservationRouteStabilityReports([report({ state: 'insufficient-data', sampleCount: 1,
      linkCount: 0, defaultRouteCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeNetworkObservationRouteStabilityReports([report({ state: 'insufficient-data', sampleCount: 0,
      linkCount: 0, defaultRouteCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeNetworkObservationRouteStabilityReports([
      report({ state: 'route-drift-sustained' }), report({ state: 'no-network', sampleCount: 1,
        linkCount: 0, defaultRouteCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-network' });
    const states = [
      ['route-drift-sustained', 'route-drift-review', 750],
      ['route-drift-observed', 'route-drift-observation', 1000],
      ['stable-routes', 'stable-route-observation', 5000],
      ['no-network', 'no-network-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-network';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildNetworkObservationRouteStabilityPlan(report({ state, sampleCount,
        linkCount: empty ? 0 : 2, defaultRouteCount: empty ? 0 : 1,
        observedCount: empty ? 0 : sampleCount, noNetworkCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildNetworkObservationRouteStabilityPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildNetworkObservationRouteStabilityPlan(report({ sampleCount: 0, linkCount: 0,
      defaultRouteCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildNetworkObservationRouteStabilityEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: NETWORK_OBSERVATION_ROUTE_STABILITY_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createNetworkObservationRouteStabilityLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(NETWORK_OBSERVATION_ROUTE_STABILITY_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, linkCount: 0,
      defaultRouteCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeNetworkObservationRouteStabilityReports(null)).toThrow('reports must be an array');
    expect(() => mergeNetworkObservationRouteStabilityReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeNetworkObservationRouteStabilityReports([null])).toThrow('report must be an object');
    expect(() => mergeNetworkObservationRouteStabilityReports([report({ turbo: 'other' })]))
      .toThrow('requires a route-stability turbo report');
    expect(() => mergeNetworkObservationRouteStabilityReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeNetworkObservationRouteStabilityReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeNetworkObservationRouteStabilityReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeNetworkObservationRouteStabilityReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noNetworkCount', 'comparisonCount', 'routeChangeSampleCount']) {
      expect(() => mergeNetworkObservationRouteStabilityReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeNetworkObservationRouteStabilityReports([report({ linkCount: 4097 })]))
      .toThrow('linkCount must be from 0 to 4096');
    expect(() => mergeNetworkObservationRouteStabilityReports([report({ defaultRouteCount: 3 })]))
      .toThrow('defaultRouteCount must fit inside linkCount');
    expect(() => mergeNetworkObservationRouteStabilityReports([report({ routeChangeCount: 8193 })]))
      .toThrow('routeChangeCount must be from 0 to 8192');
    expect(() => mergeNetworkObservationRouteStabilityReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildNetworkObservationRouteStabilityEnvelope(report())).toThrow('trigger is required');
    expect(() => buildNetworkObservationRouteStabilityEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
