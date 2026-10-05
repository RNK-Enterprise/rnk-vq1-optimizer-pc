import {
  BATTERY_ENGINE_ID,
  BATTERY_ENGINE_VERSION,
  BATTERY_TRIGGERS,
  runBatteryEngine
} from '../pc/engines/battery/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    capabilities: { batteryObservation: true },
    battery: { present: true, chargePercent: 80, charging: false, health: 'healthy' },
    ...overrides
  };
}

describe('Battery engine', () => {
  test('publishes identity and triggers', () => {
    expect(BATTERY_ENGINE_ID).toBe('battery');
    expect(BATTERY_ENGINE_VERSION).toBe(1);
    expect(BATTERY_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(BATTERY_TRIGGERS)).toBe(true);
  });

  test('reports a healthy battery without changing power policy', () => {
    const result = runBatteryEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: BATTERY_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      present: true,
      chargePercent: 80,
      charging: false,
      health: 'healthy',
      observationEnabled: true,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('handles no-battery headless hosts and low charge', () => {
    expect(runBatteryEngine(facts({
      environment: 'headless',
      battery: { present: false }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      present: false,
      state: 'no-battery',
      recommendations: ['keep-battery-controls-disabled']
    });
    expect(runBatteryEngine(facts({
      battery: { present: true, chargePercent: 10, charging: true, health: 'healthy' }
    }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      chargePercent: 10,
      charging: true,
      state: 'low-charge',
      recommendations: ['review-user-owned-power-policy']
    });
  });

  test('reports failed and degraded health', () => {
    expect(runBatteryEngine(facts({
      battery: { present: true, chargePercent: 80, health: 'failed' }
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      health: 'failed',
      state: 'protect-power',
      recommendations: ['protect-power', 'request-user-approved-battery-review']
    });
    expect(runBatteryEngine(facts({
      battery: { present: true, chargePercent: 80, health: 'degraded' }
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      health: 'degraded',
      state: 'review-health',
      recommendations: ['review-battery-health']
    });
  });

  test('reports disabled, unknown, and malformed battery evidence', () => {
    expect(runBatteryEngine(facts({
      capabilities: { batteryObservation: false }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      observationEnabled: false,
      state: 'observation-disabled',
      recommendations: ['keep-battery-observation-disabled']
    });
    expect(runBatteryEngine(facts({
      battery: { present: undefined, chargePercent: undefined, charging: undefined, health: undefined }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      present: null,
      chargePercent: null,
      charging: null,
      health: 'unknown',
      state: 'observation-required',
      confidence: 0.2,
      recommendations: ['request-battery-observation']
    });
  });

  test('handles unknown environments and bounds battery values', () => {
    expect(runBatteryEngine(facts({
      environment: 'other',
      capabilities: undefined,
      battery: { present: true, chargePercent: 50, charging: 'yes', health: 'vendor-health' }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      charging: null,
      health: 'unknown',
      state: 'profile-required',
      confidence: 0.6,
      recommendations: ['request-environment-profile']
    });
    expect(runBatteryEngine(facts({
      battery: { present: true, chargePercent: 120, charging: 1, health: null }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      chargePercent: 100,
      charging: null,
      health: 'unknown',
      state: 'observe'
    });
  });

  test('requires facts, battery object, triggers, and clock', () => {
    expect(() => runBatteryEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runBatteryEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runBatteryEngine(facts({ battery: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a battery object');
    expect(() => runBatteryEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported battery trigger: bad');
    expect(() => runBatteryEngine(facts(), {}))
      .toThrow('Unsupported battery trigger: unknown');
    expect(() => runBatteryEngine())
      .toThrow('Unsupported battery trigger: unknown');
    expect(() => runBatteryEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Battery clock must return a number');
  });
});
