import {
  NETWORK_SAFETY_ENGINE_ID,
  NETWORK_SAFETY_ENGINE_VERSION,
  NETWORK_SAFETY_TRIGGERS,
  runNetworkSafetyEngine
} from '../pc/engines/network-safety/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    capabilities: { networkObservation: true },
    network: [
      { name: 'mesh0', kind: 'mesh', encrypted: true, trusted: true, public: false },
      { name: 'eth0', kind: 'ethernet', encrypted: true, trusted: true, public: false }
    ],
    ...overrides
  };
}

describe('Network-safety engine', () => {
  test('publishes identity and triggers', () => {
    expect(NETWORK_SAFETY_ENGINE_ID).toBe('network-safety');
    expect(NETWORK_SAFETY_ENGINE_VERSION).toBe(1);
    expect(NETWORK_SAFETY_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(NETWORK_SAFETY_TRIGGERS)).toBe(true);
  });

  test('reports observed trusted encrypted links without tweaks', () => {
    const result = runNetworkSafetyEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: NETWORK_SAFETY_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      linkCount: 2,
      names: ['mesh0', 'eth0'],
      reviewCount: 0,
      unknownCount: 0,
      encryptedCount: 2,
      trustedCount: 2,
      publicCount: 0,
      observationEnabled: true,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(runNetworkSafetyEngine(facts({ network: [
      { name: 'private', kind: 'ethernet', encrypted: false, trusted: true, public: false }
    ] }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      reviewCount: 0,
      unknownCount: 0,
      state: 'observe'
    });
  });

  test('flags untrusted or public unencrypted links for review', () => {
    expect(runNetworkSafetyEngine(facts({ network: [
      { name: 'public', kind: 'wifi', public: true, encrypted: false, trusted: true },
      { name: 'untrusted', kind: 'ethernet', public: false, encrypted: true, trusted: false }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      reviewCount: 2,
      encryptedCount: 1,
      trustedCount: 1,
      publicCount: 1,
      state: 'review-required',
      recommendations: ['review-network-safety-evidence']
    });
  });

  test('reports unknown, disabled, and empty safety observations', () => {
    expect(runNetworkSafetyEngine(facts({ network: [{}] }), {
      trigger: 'health.interval',
      now: () => 0
    })).toMatchObject({
      linkCount: 1,
      names: [],
      reviewCount: 0,
      unknownCount: 1,
      state: 'observation-required',
      confidence: 0.75,
      recommendations: ['request-network-safety-observation']
    });
    expect(runNetworkSafetyEngine(facts({
      capabilities: { networkObservation: false }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      observationEnabled: false,
      state: 'observation-disabled',
      recommendations: ['keep-network-safety-observation-disabled']
    });
    expect(runNetworkSafetyEngine(facts({
      environment: 'headless',
      network: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      linkCount: 0,
      state: 'no-network',
      confidence: 0.25,
      recommendations: ['no-network-safety-review']
    });
  });

  test('handles unknown environments and malformed link values', () => {
    expect(runNetworkSafetyEngine(facts({
      environment: 'other',
      capabilities: undefined,
      network: [null, { name: '', kind: '', encrypted: 1, trusted: 1, public: 1 }]
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      linkCount: 1,
      names: [],
      reviewCount: 0,
      unknownCount: 1,
      state: 'profile-required',
      confidence: 0.5,
      recommendations: ['request-environment-profile']
    });
  });

  test('requires facts, network list, triggers, and clock', () => {
    expect(() => runNetworkSafetyEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runNetworkSafetyEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runNetworkSafetyEngine(facts({ network: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a network list');
    expect(() => runNetworkSafetyEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported network-safety trigger: bad');
    expect(() => runNetworkSafetyEngine(facts(), {}))
      .toThrow('Unsupported network-safety trigger: unknown');
    expect(() => runNetworkSafetyEngine())
      .toThrow('Unsupported network-safety trigger: unknown');
    expect(() => runNetworkSafetyEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Network-safety clock must return a number');
  });
});
