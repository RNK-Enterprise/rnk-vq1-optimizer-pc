import {
  THERMAL_ENGINE_ID,
  THERMAL_ENGINE_VERSION,
  THERMAL_TRIGGERS,
  runThermalEngine
} from '../pc/engines/thermal/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    capabilities: { thermalObservation: true },
    thermal: { temperatureCelsius: 55, criticalCelsius: 100, fanPercent: 40 },
    ...overrides
  };
}

describe('Thermal engine', () => {
  test('publishes identity and triggers', () => {
    expect(THERMAL_ENGINE_ID).toBe('thermal');
    expect(THERMAL_ENGINE_VERSION).toBe(1);
    expect(THERMAL_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(THERMAL_TRIGGERS)).toBe(true);
  });

  test('reports normal temperature and headroom without changes', () => {
    const result = runThermalEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: THERMAL_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      temperatureCelsius: 55,
      criticalCelsius: 100,
      fanPercent: 40,
      thermalHeadroomCelsius: 45,
      level: 'normal',
      observationEnabled: true,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('classifies elevated, high, and critical temperatures', () => {
    expect(runThermalEngine(facts({ thermal: {
      temperatureCelsius: 75, criticalCelsius: 100, fanPercent: 80
    } }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      level: 'elevated',
      state: 'watch',
      recommendations: ['observe-next-sample', 'review-thermal-headroom']
    });
    expect(runThermalEngine(facts({ thermal: {
      temperatureCelsius: 90, criticalCelsius: 100, fanPercent: 100
    } }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      level: 'high',
      state: 'protect-foreground',
      recommendations: ['protect-thermal-headroom']
    });
    expect(runThermalEngine(facts({
      environment: 'headless',
      thermal: { temperatureCelsius: 100, criticalCelsius: 100, fanPercent: 100 }
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      level: 'critical',
      state: 'protect-services',
      recommendations: ['protect-services', 'request-user-approved-thermal-response']
    });
    expect(runThermalEngine(facts({
      environment: 'headless',
      thermal: { temperatureCelsius: 90, criticalCelsius: 100, fanPercent: 100 }
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      level: 'high',
      state: 'protect-services'
    });
    expect(runThermalEngine(facts({ thermal: {
      temperatureCelsius: 100, criticalCelsius: 100, fanPercent: 100
    } }), { trigger: 'health.interval', now: () => 0 }).state).toBe('protect-foreground');
  });

  test('reports disabled and unknown thermal evidence', () => {
    expect(runThermalEngine(facts({
      capabilities: { thermalObservation: false }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      observationEnabled: false,
      state: 'observation-disabled',
      recommendations: ['keep-thermal-observation-disabled']
    });
    expect(runThermalEngine(facts({
      thermal: { temperatureCelsius: undefined, criticalCelsius: undefined, fanPercent: undefined }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      temperatureCelsius: null,
      criticalCelsius: null,
      fanPercent: null,
      thermalHeadroomCelsius: null,
      level: 'unknown',
      state: 'observation-required',
      confidence: 0.2,
      recommendations: ['request-thermal-observation']
    });
  });

  test('handles unknown environments and bounds thermal values', () => {
    expect(runThermalEngine(facts({
      environment: 'other',
      thermal: { temperatureCelsius: 50, criticalCelsius: 100, fanPercent: 50 }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0.8,
      recommendations: ['request-environment-profile']
    });
    expect(runThermalEngine(facts({
      thermal: { temperatureCelsius: -1, criticalCelsius: 0, fanPercent: 120 }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      temperatureCelsius: null,
      criticalCelsius: 0,
      fanPercent: 100,
      thermalHeadroomCelsius: null,
      level: 'unknown'
    });
  });

  test('requires facts, thermal object, triggers, and clock', () => {
    expect(() => runThermalEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runThermalEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runThermalEngine(facts({ thermal: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a thermal object');
    expect(() => runThermalEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported thermal trigger: bad');
    expect(() => runThermalEngine(facts(), {}))
      .toThrow('Unsupported thermal trigger: unknown');
    expect(() => runThermalEngine())
      .toThrow('Unsupported thermal trigger: unknown');
    expect(() => runThermalEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Thermal clock must return a number');
  });
});
