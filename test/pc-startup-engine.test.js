import {
  STARTUP_ENGINE_ID,
  STARTUP_ENGINE_VERSION,
  STARTUP_TRIGGERS,
  runStartupEngine
} from '../pc/engines/startup/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    startup: [
      { name: 'desktop', enabled: true, required: true, userOwned: false, delayMs: 10 },
      { name: 'launcher', enabled: false, required: false, userOwned: true, delayMs: 20 }
    ],
    ...overrides
  };
}

describe('Startup engine', () => {
  test('publishes identity and triggers', () => {
    expect(STARTUP_ENGINE_ID).toBe('startup');
    expect(STARTUP_ENGINE_VERSION).toBe(1);
    expect(STARTUP_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(STARTUP_TRIGGERS)).toBe(true);
  });

  test('reports startup entries without changing boot configuration', () => {
    const result = runStartupEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: STARTUP_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      startupCount: 2,
      names: ['desktop', 'launcher'],
      enabledCount: 1,
      disabledCount: 1,
      unknownCount: 0,
      requiredDisabledCount: 0,
      userOwnedEnabledCount: 0,
      maximumDelayMs: 20,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('flags required-disabled and user-owned enabled entries', () => {
    expect(runStartupEngine(facts({ startup: [
      { name: 'required', enabled: false, required: true, userOwned: false, delayMs: 1 }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      requiredDisabledCount: 1,
      state: 'required-review',
      recommendations: ['review-required-startup-owner']
    });
    expect(runStartupEngine(facts({ startup: [
      { name: 'user-app', enabled: true, required: false, userOwned: true, delayMs: 1 }
    ] }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      userOwnedEnabledCount: 1,
      state: 'user-owned-review',
      recommendations: ['review-user-owned-startup-items']
    });
  });

  test('reports unknown, empty, and malformed startup entries', () => {
    expect(runStartupEngine(facts({ startup: [{}] }), {
      trigger: 'system.facts.request',
      now: () => 0
    })).toMatchObject({
      startupCount: 1,
      names: [],
      enabledCount: 0,
      disabledCount: 0,
      unknownCount: 1,
      maximumDelayMs: null,
      state: 'observation-required',
      confidence: 0.4,
      recommendations: ['request-startup-observation']
    });
    expect(runStartupEngine(facts({ startup: [null, {
      name: '', enabled: 'yes', required: 1, userOwned: 1, delayMs: -1
    }] }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      startupCount: 1,
      names: [],
      unknownCount: 1,
      requiredDisabledCount: 0,
      userOwnedEnabledCount: 0,
      maximumDelayMs: null
    });
    expect(runStartupEngine(facts({
      environment: 'headless',
      startup: []
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      startupCount: 0,
      state: 'no-startup-items',
      confidence: 0.2,
      recommendations: ['no-startup-review']
    });
  });

  test('handles unknown environments and rejects malformed inputs', () => {
    expect(runStartupEngine(facts({
      environment: 'other',
      startup: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(() => runStartupEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runStartupEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runStartupEngine(facts({ startup: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a startup list');
    expect(() => runStartupEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported startup trigger: bad');
    expect(() => runStartupEngine(facts(), {}))
      .toThrow('Unsupported startup trigger: unknown');
    expect(() => runStartupEngine())
      .toThrow('Unsupported startup trigger: unknown');
    expect(() => runStartupEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Startup clock must return a number');
  });
});
