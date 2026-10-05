import {
  SYSTEM_FACTS_PRESSURE_TRIGGERS,
  SYSTEM_FACTS_PRESSURE_TURBO_ID,
  SYSTEM_FACTS_PRESSURE_TURBO_VERSION,
  runPressureTurbo
} from '../pc/engines/system-facts/turbos/pressure/turbo.js';

function snapshot(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    cpu: { utilizationPercent: 10 },
    memory: { usedPercent: 10, swapUsedPercent: 10 },
    pressure: { cpu: 'normal', memory: 'normal', swap: 'normal', storage: 'normal' },
    storage: [{ usedPercent: 10 }],
    gpus: [{ utilizationPercent: 10, temperatureCelsius: 30 }],
    ...overrides
  };
}

describe('system-facts pressure turbo', () => {
  test('publishes identity and trigger contract', () => {
    expect(SYSTEM_FACTS_PRESSURE_TURBO_ID).toBe('system-facts.pressure');
    expect(SYSTEM_FACTS_PRESSURE_TURBO_VERSION).toBe(1);
    expect(SYSTEM_FACTS_PRESSURE_TRIGGERS).toEqual([
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(SYSTEM_FACTS_PRESSURE_TRIGGERS)).toBe(true);
  });

  test('returns normal interactive pressure without actions', () => {
    const result = runPressureTurbo(snapshot(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result.protocolVersion).toBe(1);
    expect(result.turbo).toBe(SYSTEM_FACTS_PRESSURE_TURBO_ID);
    expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(result.level).toBe('normal');
    expect(result.state).toBe('observe');
    expect(result.dominant).toBe('gpu');
    expect(result.confidence).toBe(1);
    expect(result.headroom).toEqual({ cpu: 0.85, memory: 0.85, swap: 0.85, storage: 0.85, gpu: 0.75 });
    expect(result.recommendations).toEqual(['no-change']);
    expect(result.actions).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('classifies elevated and high interactive pressure', () => {
    const elevated = runPressureTurbo(snapshot({
      cpu: { utilizationPercent: 70 },
      memory: { usedPercent: 70, swapUsedPercent: 10 },
      pressure: { cpu: 'elevated', memory: 'elevated', swap: 'normal', storage: 'normal' }
    }), { trigger: 'workload.changed', now: () => 0 });
    expect(elevated.level).toBe('elevated');
    expect(elevated.state).toBe('watch');
    expect(elevated.recommendations).toEqual(['observe-next-sample', 'inspect-cpu-pressure']);

    const high = runPressureTurbo(snapshot({
      cpu: { utilizationPercent: 100 },
      memory: { usedPercent: 100, swapUsedPercent: 100 },
      pressure: { cpu: 'high', memory: 'high', swap: 'high', storage: 'high' },
      storage: [{ usedPercent: 100 }],
      gpus: [{ utilizationPercent: 100, temperatureCelsius: 120 }]
    }), { trigger: 'health.interval', now: () => 0 });
    expect(high.level).toBe('high');
    expect(high.state).toBe('protect-foreground');
    expect(high.dominant).toBe('cpu');
    expect(high.recommendations).toEqual([
      'protect-foreground', 'inspect-cpu-pressure', 'hold-destructive-actions'
    ]);
  });

  test('uses headless service protection and unknown-profile state', () => {
    const server = runPressureTurbo(snapshot({
      environment: 'headless',
      cpu: { utilizationPercent: 100 },
      memory: { usedPercent: 100, swapUsedPercent: 100 },
      pressure: { cpu: 'high', memory: 'high', swap: 'high', storage: 'high' },
      storage: [{ usedPercent: 100 }],
      gpus: []
    }), { trigger: 'health.interval', now: () => 0 });
    expect(server.state).toBe('protect-services');
    expect(server.recommendations).toEqual([
      'protect-services', 'inspect-cpu-pressure', 'hold-destructive-actions'
    ]);

    const unknown = runPressureTurbo(snapshot({
      environment: 'unknown',
      cpu: { utilizationPercent: 100 },
      pressure: { cpu: 'high', memory: 'high', swap: 'high', storage: 'high' },
      memory: { usedPercent: 100, swapUsedPercent: 100 },
      storage: [{ usedPercent: 100 }],
      gpus: []
    }), { trigger: 'health.interval', now: () => 0 });
    expect(unknown.state).toBe('profile-required');
    expect(unknown.recommendations).toEqual(['request-environment-profile']);
  });

  test('handles missing and unknown measurements', () => {
    const result = runPressureTurbo(snapshot({
      cpu: {},
      memory: {},
      pressure: { cpu: 'unknown', memory: 'not-known', swap: 'unknown', storage: 'unknown' },
      storage: [],
      gpus: undefined
    }), { trigger: 'health.interval', now: () => 0 });
    expect(result.signals.gpu).toBeNull();
    expect(result.signals.storage).toBe(0.35);
    expect(result.level).toBe('elevated');
    expect(result.confidence).toBe(0.3375);
    expect(result.headroom.gpu).toBeUndefined();
  });

  test('uses maximum storage and GPU signals across devices', () => {
    const result = runPressureTurbo(snapshot({
      storage: [{ usedPercent: 10 }, { usedPercent: 90 }],
      gpus: [
        { utilizationPercent: 10, temperatureCelsius: 30 },
        { utilizationPercent: 80, temperatureCelsius: 20 }
      ]
    }), { trigger: 'health.interval', now: () => 0 });
    expect(result.signals.storage).toBe(0.9);
    expect(result.signals.gpu).toBe(0.8);
  });

  test('rejects malformed snapshots, triggers, and clocks', () => {
    expect(() => runPressureTurbo(null, { trigger: 'health.interval' }))
      .toThrow('Pressure turbo snapshot must be an object');
    expect(() => runPressureTurbo({ engine: 'other' }, { trigger: 'health.interval' }))
      .toThrow('requires a system-facts snapshot');
    expect(() => runPressureTurbo({ engine: 'system-facts' }, { trigger: 'health.interval' }))
      .toThrow('missing normalized sections');
    expect(() => runPressureTurbo(snapshot(), { trigger: 'bad' }))
      .toThrow('Unsupported pressure turbo trigger: bad');
    expect(() => runPressureTurbo(snapshot(), {}))
      .toThrow('Unsupported pressure turbo trigger: unknown');
    expect(() => runPressureTurbo())
      .toThrow('Unsupported pressure turbo trigger: unknown');
    expect(() => runPressureTurbo(snapshot(), { trigger: 'health.interval', now: () => NaN }))
      .toThrow('Pressure turbo clock must return a number');
  });
});
