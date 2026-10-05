import {
  BACKGROUND_SERVICES_ENGINE_ID,
  BACKGROUND_SERVICES_ENGINE_VERSION,
  BACKGROUND_SERVICES_TRIGGERS,
  runBackgroundServicesEngine
} from '../pc/engines/background-services/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    capabilities: { backgroundServiceObservation: true },
    services: [
      { name: 'desktop', state: 'running', critical: true, userOwned: true },
      { name: 'helper', state: 'stopped', critical: false, userOwned: false }
    ],
    ...overrides
  };
}

describe('Background-services engine', () => {
  test('publishes identity and triggers', () => {
    expect(BACKGROUND_SERVICES_ENGINE_ID).toBe('background-services');
    expect(BACKGROUND_SERVICES_ENGINE_VERSION).toBe(1);
    expect(BACKGROUND_SERVICES_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(BACKGROUND_SERVICES_TRIGGERS)).toBe(true);
  });

  test('reports service state without changing services', () => {
    const result = runBackgroundServicesEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: BACKGROUND_SERVICES_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      serviceCount: 2,
      names: ['desktop', 'helper'],
      runningCount: 1,
      stoppedCount: 1,
      failedCount: 0,
      criticalFailureCount: 0,
      unknownStateCount: 0,
      userOwnedCount: 1,
      observationEnabled: true,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('protects services when a critical service fails', () => {
    expect(runBackgroundServicesEngine(facts({ services: [
      { name: 'critical', state: 'failed', critical: true, userOwned: false }
    ] }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      failedCount: 1,
      criticalFailureCount: 1,
      state: 'protect-services',
      recommendations: ['protect-services', 'review-service-owner']
    });
  });

  test('reports unknown, disabled, empty, and malformed services', () => {
    expect(runBackgroundServicesEngine(facts({ services: [{}] }), {
      trigger: 'workload.changed',
      now: () => 0
    })).toMatchObject({
      serviceCount: 1,
      names: [],
      unknownStateCount: 1,
      userOwnedCount: 0,
      state: 'observation-required',
      confidence: 0.4,
      recommendations: ['request-service-state-observation']
    });
    expect(runBackgroundServicesEngine(facts({
      capabilities: { backgroundServiceObservation: false }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      observationEnabled: false,
      state: 'observation-disabled',
      recommendations: ['keep-service-observation-disabled']
    });
    expect(runBackgroundServicesEngine(facts({
      environment: 'headless',
      services: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      serviceCount: 0,
      state: 'no-services',
      confidence: 0.2,
      recommendations: ['no-background-service-review']
    });
    expect(runBackgroundServicesEngine(facts({ services: [null, {
      name: '', state: 'vendor-state', critical: 1, userOwned: 1
    }] }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      serviceCount: 1,
      names: [],
      unknownStateCount: 1,
      userOwnedCount: 0
    });
  });

  test('handles unknown environments and rejects malformed inputs', () => {
    expect(runBackgroundServicesEngine(facts({
      environment: 'other',
      capabilities: undefined,
      services: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(() => runBackgroundServicesEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runBackgroundServicesEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runBackgroundServicesEngine(facts({ services: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a service list');
    expect(() => runBackgroundServicesEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported background-services trigger: bad');
    expect(() => runBackgroundServicesEngine(facts(), {}))
      .toThrow('Unsupported background-services trigger: unknown');
    expect(() => runBackgroundServicesEngine())
      .toThrow('Unsupported background-services trigger: unknown');
    expect(() => runBackgroundServicesEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Background-services clock must return a number');
  });
});
