import {
  DRIVER_CAPABILITY_LIBRARY_ID,
  DRIVER_CAPABILITY_LIBRARY_VERSION,
  buildDriverCapabilityEnvelope,
  classifyDriverCapability,
  compareDriverCapability,
  createDriverCapabilityLibrary
} from '../pc/engines/driver-capability/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    drivers: [
      { name: 'gpu', vendor: 'Nvidia', version: '1', documented: true },
      { name: 'audio', vendor: 'Vendor', version: '2', documented: true }
    ],
    ...overrides
  };
}

describe('Driver-capability library', () => {
  test('classifies documented driver capability evidence', () => {
    expect(classifyDriverCapability(facts())).toMatchObject({
      library: DRIVER_CAPABILITY_LIBRARY_ID,
      libraryVersion: DRIVER_CAPABILITY_LIBRARY_VERSION,
      environment: 'interactive', driverCount: 2, names: ['gpu', 'audio'],
      vendors: ['Nvidia', 'Vendor'], versions: ['1', '2'],
      evidenceStates: ['documented', 'documented'], documentedCount: 2,
      unverifiedCount: 0, unknownCount: 0, state: 'observe', confidence: 1,
      recommendations: ['no-change']
    });
    expect(Object.isFrozen(classifyDriverCapability(facts()).supportedEvidence)).toBe(true);
    expect(classifyDriverCapability(facts({ drivers: [
      { name: 'gpu', vendor: 'Nvidia', version: '1', documented: false }
    ] }))).toMatchObject({ documentedCount: 0, unverifiedCount: 1, unknownCount: 0,
      state: 'review-required', confidence: 0.7,
      recommendations: ['review-driver-source-without-change'] });
  });

  test('preserves unknown, empty, profile, and incomplete states', () => {
    expect(classifyDriverCapability(facts({ drivers: [
      { name: null, vendor: null, version: null }
    ] }))).toMatchObject({ driverCount: 1, names: [], vendors: [], versions: [],
      evidenceStates: ['unknown'], documentedCount: 0, unverifiedCount: 0, unknownCount: 1,
      state: 'observation-required', confidence: 0.4,
      recommendations: ['request-driver-capability-observation'] });
    expect(classifyDriverCapability(facts({ drivers: [] }))).toMatchObject({
      driverCount: 0, state: 'no-drivers', confidence: 0.2,
      recommendations: ['no-driver-capability-review']
    });
    expect(classifyDriverCapability(facts({ environment: 'other', drivers: [] }))).toMatchObject({
      environment: 'unknown', state: 'profile-required', confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(classifyDriverCapability(facts({ drivers: [null, {
      name: 'gpu', vendor: '', version: '', documented: 'yes'
    }] }))).toMatchObject({ driverCount: 1, names: ['gpu'], vendors: [], versions: [],
      evidenceStates: ['unknown'], confidence: 0.7 });
  });

  test('compares capability samples and builds immutable local facades', () => {
    expect(compareDriverCapability(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, countChanged: false, documentedChanged: false,
      unverifiedChanged: false, unknownChanged: false, namesChanged: false, versionsChanged: false
    });
    expect(compareDriverCapability(facts(), facts({ drivers: [
      { name: 'gpu', vendor: 'Nvidia', version: '3', documented: false },
      { name: 'new', vendor: 'Vendor', version: '1', documented: true },
      { name: 'unknown', vendor: 'Vendor', version: '', documented: null }
    ] }))).toMatchObject({
      changed: true, stateChanged: true, countChanged: true, documentedChanged: true,
      unverifiedChanged: true, unknownChanged: true, namesChanged: true, versionsChanged: true
    });
    const envelope = buildDriverCapabilityEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createDriverCapabilityLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyDriverCapability(null)).toThrow('facts must be an object');
    expect(() => classifyDriverCapability({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyDriverCapability({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyDriverCapability({ ...facts(), drivers: null }))
      .toThrow('requires a driver list');
    expect(() => buildDriverCapabilityEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildDriverCapabilityEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildDriverCapabilityEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildDriverCapabilityEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createDriverCapabilityLibrary(null)).toThrow('options must be an object');
    expect(() => createDriverCapabilityLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
