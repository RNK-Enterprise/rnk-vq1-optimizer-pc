import {
  DRIVER_CAPABILITY_ENGINE_ID,
  DRIVER_CAPABILITY_ENGINE_VERSION,
  DRIVER_CAPABILITY_TRIGGERS,
  runDriverCapabilityEngine
} from '../pc/engines/driver-capability/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    drivers: [
      { name: 'nvidia', vendor: 'NVIDIA', version: '610', documented: true },
      { name: 'i915', vendor: 'Intel', version: '1', documented: true }
    ],
    ...overrides
  };
}

describe('Driver-capability engine', () => {
  test('publishes identity and triggers', () => {
    expect(DRIVER_CAPABILITY_ENGINE_ID).toBe('driver-capability');
    expect(DRIVER_CAPABILITY_ENGINE_VERSION).toBe(1);
    expect(DRIVER_CAPABILITY_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(DRIVER_CAPABILITY_TRIGGERS)).toBe(true);
  });

  test('reports documented driver evidence without changing drivers', () => {
    const result = runDriverCapabilityEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: DRIVER_CAPABILITY_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      driverCount: 2,
      names: ['nvidia', 'i915'],
      vendors: ['NVIDIA', 'Intel'],
      versions: ['610', '1'],
      evidenceStates: ['documented', 'documented'],
      documentedCount: 2,
      unverifiedCount: 0,
      unknownCount: 0,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('keeps unverified drivers in review', () => {
    expect(runDriverCapabilityEngine(facts({ drivers: [
      { name: 'vendor', vendor: 'Vendor', version: 'x', documented: false }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      unverifiedCount: 1,
      state: 'review-required',
      recommendations: ['review-driver-source-without-change']
    });
  });

  test('reports unknown, empty, and malformed driver evidence', () => {
    expect(runDriverCapabilityEngine(facts({ drivers: [{}] }), {
      trigger: 'health.interval',
      now: () => 0
    })).toMatchObject({
      driverCount: 1,
      names: [],
      vendors: [],
      versions: [],
      evidenceStates: ['unknown'],
      unknownCount: 1,
      state: 'observation-required',
      confidence: 0.4,
      recommendations: ['request-driver-capability-observation']
    });
    expect(runDriverCapabilityEngine(facts({ drivers: [null, {
      name: '', vendor: '', version: '', documented: 'yes'
    }] }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      driverCount: 1,
      names: [],
      evidenceStates: ['unknown'],
      unknownCount: 1
    });
    expect(runDriverCapabilityEngine(facts({
      environment: 'headless',
      drivers: []
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      driverCount: 0,
      state: 'no-drivers',
      confidence: 0.2,
      recommendations: ['no-driver-capability-review']
    });
  });

  test('handles unknown environments and rejects malformed inputs', () => {
    expect(runDriverCapabilityEngine(facts({
      environment: 'other',
      drivers: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(() => runDriverCapabilityEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runDriverCapabilityEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runDriverCapabilityEngine(facts({ drivers: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a driver list');
    expect(() => runDriverCapabilityEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported driver-capability trigger: bad');
    expect(() => runDriverCapabilityEngine(facts(), {}))
      .toThrow('Unsupported driver-capability trigger: unknown');
    expect(() => runDriverCapabilityEngine())
      .toThrow('Unsupported driver-capability trigger: unknown');
    expect(() => runDriverCapabilityEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Driver-capability clock must return a number');
  });
});
