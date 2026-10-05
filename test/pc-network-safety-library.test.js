import {
  NETWORK_SAFETY_LIBRARY_ID,
  NETWORK_SAFETY_LIBRARY_VERSION,
  buildNetworkSafetyEnvelope,
  classifyNetworkSafety,
  compareNetworkSafety,
  createNetworkSafetyLibrary
} from '../pc/engines/network-safety/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    network: [
      { name: 'eth0', kind: 'ethernet', trusted: true, encrypted: true, public: false }
    ],
    capabilities: { networkObservation: true },
    ...overrides
  };
}

describe('Network-safety library', () => {
  test('classifies observed, review, and bounded trust evidence', () => {
    expect(classifyNetworkSafety(facts())).toMatchObject({
      library: NETWORK_SAFETY_LIBRARY_ID,
      libraryVersion: NETWORK_SAFETY_LIBRARY_VERSION,
      environment: 'interactive', linkCount: 1, names: ['eth0'],
      reviewCount: 0, unknownCount: 0, encryptedCount: 1, trustedCount: 1, publicCount: 0,
      observationEnabled: true, state: 'observe', confidence: 1, recommendations: ['no-change']
    });
    expect(classifyNetworkSafety(facts({ network: [
      { name: 'public', trusted: true, encrypted: false, public: true }
    ] }))).toMatchObject({ reviewCount: 1, unknownCount: 0,
      encryptedCount: 0, trustedCount: 1, publicCount: 1, state: 'review-required', confidence: 0.75,
      recommendations: ['review-network-safety-evidence'] });
    expect(classifyNetworkSafety(facts({ network: [
      { name: 'trusted-private', trusted: true, encrypted: false, public: false }
    ] }))).toMatchObject({ reviewCount: 0, unknownCount: 0, state: 'observe' });
    expect(classifyNetworkSafety(facts({ network: [
      { name: 'untrusted', trusted: false, encrypted: true, public: false }
    ] }))).toMatchObject({ reviewCount: 1, state: 'review-required' });
    expect(classifyNetworkSafety(facts({ network: [{}] }))).toMatchObject({
      linkCount: 1, names: [], reviewCount: 0, unknownCount: 1, encryptedCount: 0,
      trustedCount: 0, publicCount: 0, state: 'observation-required', confidence: 0.75,
      recommendations: ['request-network-safety-observation']
    });
  });

  test('preserves no-network, disabled, and profile-required states', () => {
    expect(classifyNetworkSafety(facts({ network: [] }))).toMatchObject({
      linkCount: 0, state: 'no-network', confidence: 0.25,
      recommendations: ['no-network-safety-review']
    });
    expect(classifyNetworkSafety(facts({ capabilities: { networkObservation: false } })))
      .toMatchObject({ observationEnabled: false, state: 'observation-disabled',
        recommendations: ['keep-network-safety-observation-disabled'] });
    expect(classifyNetworkSafety(facts({ environment: 'other', network: [] }))).toMatchObject({
      environment: 'unknown', state: 'profile-required', confidence: 0,
      recommendations: ['request-environment-profile']
    });
  });

  test('compares safety samples and builds immutable local facades', () => {
    expect(compareNetworkSafety(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, countChanged: false, reviewChanged: false,
      unknownChanged: false, encryptedChanged: false, trustedChanged: false,
      publicChanged: false, observationChanged: false
    });
    expect(compareNetworkSafety(facts(), facts({ network: [
      { name: 'eth0', trusted: false, encrypted: false, public: true },
      { name: 'wlan0', trusted: true, encrypted: true, public: true }
    ] }))).toMatchObject({
      changed: true, stateChanged: true, countChanged: true, reviewChanged: true,
      unknownChanged: false, encryptedChanged: false, trustedChanged: false,
      publicChanged: true, observationChanged: false
    });
    expect(compareNetworkSafety(facts(), facts({ network: [{}] }))).toMatchObject({
      changed: true, stateChanged: true, countChanged: false, reviewChanged: false,
      unknownChanged: true, encryptedChanged: true, trustedChanged: true, publicChanged: false
    });
    expect(compareNetworkSafety(facts(), facts({ capabilities: { networkObservation: false } })))
      .toMatchObject({ changed: true, stateChanged: true, observationChanged: true });
    const envelope = buildNetworkSafetyEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createNetworkSafetyLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyNetworkSafety(null)).toThrow('facts must be an object');
    expect(() => classifyNetworkSafety({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyNetworkSafety({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyNetworkSafety({ ...facts(), network: null }))
      .toThrow('requires a network list');
    expect(() => buildNetworkSafetyEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildNetworkSafetyEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildNetworkSafetyEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildNetworkSafetyEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createNetworkSafetyLibrary(null)).toThrow('options must be an object');
    expect(() => createNetworkSafetyLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
