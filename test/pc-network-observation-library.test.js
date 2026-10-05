import {
  NETWORK_OBSERVATION_LIBRARY_ID,
  NETWORK_OBSERVATION_LIBRARY_VERSION,
  buildNetworkObservationEnvelope,
  classifyNetworkObservation,
  compareNetworkObservation,
  createNetworkObservationLibrary
} from '../pc/engines/network-observation/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    network: [
      { name: 'eth0', kind: 'ethernet', state: 'up', mesh: true, defaultRoute: true },
      { name: 'wlan0', kind: 'wifi', state: 'down', mesh: false, defaultRoute: false }
    ],
    capabilities: { networkObservation: true },
    ...overrides
  };
}

describe('Network-observation library', () => {
  test('classifies bounded links, mesh evidence, and routes', () => {
    expect(classifyNetworkObservation(facts())).toMatchObject({
      library: NETWORK_OBSERVATION_LIBRARY_ID,
      libraryVersion: NETWORK_OBSERVATION_LIBRARY_VERSION,
      environment: 'interactive',
      linkCount: 2,
      names: ['eth0', 'wlan0'],
      kinds: ['ethernet', 'wifi'],
      states: ['up', 'down'],
      meshLinkCount: 1,
      defaultRouteCount: 1,
      stateKnown: true,
      observationEnabled: true,
      state: 'observe', confidence: 1, recommendations: ['no-change']
    });
    expect(classifyNetworkObservation(facts({ network: [
      { name: 'a', kind: 'mesh', state: 'up', mesh: true, defaultRoute: true },
      { name: 'b', kind: 'mesh', state: 'up', mesh: true, defaultRoute: true }
    ] }))).toMatchObject({ meshLinkCount: 2, defaultRouteCount: 2,
      state: 'route-review', recommendations: ['review-routes-without-network-mutation'] });
  });

  test('preserves no-network, disabled, unknown, and incomplete states', () => {
    expect(classifyNetworkObservation(facts({ network: [] }))).toMatchObject({
      linkCount: 0, meshLinkCount: 0, defaultRouteCount: 0, stateKnown: true,
      state: 'no-network', confidence: 0.75, recommendations: ['no-network-review']
    });
    expect(classifyNetworkObservation(facts({ capabilities: { networkObservation: false } })))
      .toMatchObject({ observationEnabled: false, state: 'observation-disabled',
        recommendations: ['keep-network-observation-disabled'] });
    expect(classifyNetworkObservation(facts({ environment: 'other', network: [] })))
      .toMatchObject({ environment: 'unknown', state: 'profile-required', confidence: 0.5,
        recommendations: ['request-environment-profile'] });
    expect(classifyNetworkObservation(facts({ network: [null, {
      name: '', kind: null, state: null, mesh: true, defaultRoute: false
    }] }))).toMatchObject({ linkCount: 1, names: [], kinds: [], states: [], meshLinkCount: 1,
      defaultRouteCount: 0, stateKnown: false, confidence: 0.75 });
  });

  test('compares observations and builds immutable local facades', () => {
    expect(compareNetworkObservation(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, countChanged: false, meshChanged: false,
      routeChanged: false, knownChanged: false, observationChanged: false
    });
    expect(compareNetworkObservation(facts(), facts({ network: [
      { name: 'eth0', kind: 'ethernet', state: 'up', mesh: false, defaultRoute: true },
      { name: 'wlan0', kind: 'wifi', state: 'up', mesh: false, defaultRoute: true },
      { name: 'vpn0', kind: 'tunnel', state: 'up', mesh: false, defaultRoute: false }
    ] }))).toMatchObject({
      changed: true, stateChanged: true, countChanged: true, meshChanged: true,
      routeChanged: true, knownChanged: false, observationChanged: false
    });
    expect(compareNetworkObservation(facts(), facts({ network: [
      { name: 'eth0', kind: 'ethernet', state: null, mesh: true, defaultRoute: true },
      { name: 'wlan0', kind: 'wifi', state: 'down', mesh: false, defaultRoute: false }
    ] }))).toMatchObject({ changed: true, stateChanged: false, countChanged: false,
      meshChanged: false, routeChanged: false, knownChanged: true, observationChanged: false });
    expect(compareNetworkObservation(facts(), facts({ capabilities: { networkObservation: false } })))
      .toMatchObject({ changed: true, stateChanged: true, observationChanged: true });
    const envelope = buildNetworkObservationEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createNetworkObservationLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyNetworkObservation(null)).toThrow('facts must be an object');
    expect(() => classifyNetworkObservation({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyNetworkObservation({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyNetworkObservation({ ...facts(), network: null }))
      .toThrow('requires a network list');
    expect(() => buildNetworkObservationEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildNetworkObservationEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildNetworkObservationEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildNetworkObservationEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createNetworkObservationLibrary(null)).toThrow('options must be an object');
    expect(() => createNetworkObservationLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
