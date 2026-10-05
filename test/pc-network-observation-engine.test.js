import {
  NETWORK_OBSERVATION_ENGINE_ID,
  NETWORK_OBSERVATION_ENGINE_VERSION,
  NETWORK_OBSERVATION_TRIGGERS,
  runNetworkObservationEngine
} from '../pc/engines/network-observation/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    capabilities: { networkObservation: true },
    network: [
      { name: 'mesh0', kind: 'mesh', state: 'up', mesh: true, defaultRoute: false },
      { name: 'eth0', kind: 'ethernet', state: 'up', mesh: false, defaultRoute: true }
    ],
    ...overrides
  };
}

describe('Network-observation engine', () => {
  test('publishes identity and triggers', () => {
    expect(NETWORK_OBSERVATION_ENGINE_ID).toBe('network-observation');
    expect(NETWORK_OBSERVATION_ENGINE_VERSION).toBe(1);
    expect(NETWORK_OBSERVATION_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(NETWORK_OBSERVATION_TRIGGERS)).toBe(true);
  });

  test('reports links and routes without changing networking', () => {
    const result = runNetworkObservationEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: NETWORK_OBSERVATION_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      linkCount: 2,
      names: ['mesh0', 'eth0'],
      kinds: ['mesh', 'ethernet'],
      states: ['up', 'up'],
      meshLinkCount: 1,
      defaultRouteCount: 1,
      stateKnown: true,
      observationEnabled: true,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('flags ambiguous default routes conservatively', () => {
    expect(runNetworkObservationEngine(facts({ network: [
      { name: 'eth0', kind: 'ethernet', state: 'up', defaultRoute: true },
      { name: 'wifi0', kind: 'wifi', state: 'up', defaultRoute: true }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      defaultRouteCount: 2,
      state: 'route-review',
      recommendations: ['review-routes-without-network-mutation']
    });
  });

  test('reports disabled, empty, and incomplete network observations', () => {
    expect(runNetworkObservationEngine(facts({
      capabilities: { networkObservation: false }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      observationEnabled: false,
      state: 'observation-disabled',
      recommendations: ['keep-network-observation-disabled']
    });
    expect(runNetworkObservationEngine(facts({
      environment: 'headless',
      network: []
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      linkCount: 0,
      state: 'no-network',
      confidence: 0.75,
      recommendations: ['no-network-review']
    });
    expect(runNetworkObservationEngine(facts({ network: [{}] }), {
      trigger: 'system.facts.request',
      now: () => 0
    })).toMatchObject({
      linkCount: 1,
      names: [],
      kinds: [],
      states: [],
      stateKnown: false,
      confidence: 0.75
    });
  });

  test('handles unknown environments and malformed link rows', () => {
    expect(runNetworkObservationEngine(facts({
      environment: 'other',
      capabilities: undefined,
      network: [null, { name: '', kind: '', state: '', mesh: 1, defaultRoute: 1 }]
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      linkCount: 1,
      names: [],
      kinds: [],
      states: [],
      meshLinkCount: 0,
      defaultRouteCount: 0,
      state: 'profile-required',
      confidence: 0.5,
      recommendations: ['request-environment-profile']
    });
  });

  test('requires facts, network list, triggers, and clock', () => {
    expect(() => runNetworkObservationEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runNetworkObservationEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runNetworkObservationEngine(facts({ network: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a network list');
    expect(() => runNetworkObservationEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported network-observation trigger: bad');
    expect(() => runNetworkObservationEngine(facts(), {}))
      .toThrow('Unsupported network-observation trigger: unknown');
    expect(() => runNetworkObservationEngine())
      .toThrow('Unsupported network-observation trigger: unknown');
    expect(() => runNetworkObservationEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Network-observation clock must return a number');
  });
});
