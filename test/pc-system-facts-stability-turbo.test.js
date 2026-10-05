import {
  SYSTEM_FACTS_STABILITY_TURBO_ID,
  SYSTEM_FACTS_STABILITY_TURBO_VERSION,
  SYSTEM_FACTS_STABILITY_TRIGGERS,
  runStabilityTurbo
} from '../pc/engines/system-facts/turbos/stability/turbo.js';

function snapshot(overrides = {}) {
  return {
    engine: 'system-facts',
    cpu: { utilizationPercent: 10 },
    memory: { usedPercent: 10, swapUsedPercent: 10 },
    pressure: { cpu: 'normal', memory: 'normal', swap: 'normal', storage: 'normal' },
    storage: [{ usedPercent: 10 }],
    gpus: [{}],
    network: [{ mesh: true }],
    ...overrides
  };
}

function repeated(count, value = snapshot()) {
  return Array.from({ length: count }, () => ({
    ...value,
    cpu: { ...value.cpu },
    memory: { ...value.memory },
    pressure: { ...value.pressure }
  }));
}

describe('system-facts stability turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(SYSTEM_FACTS_STABILITY_TURBO_ID).toBe('system-facts.stability');
    expect(SYSTEM_FACTS_STABILITY_TURBO_VERSION).toBe(1);
    expect(SYSTEM_FACTS_STABILITY_TRIGGERS).toEqual([
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(SYSTEM_FACTS_STABILITY_TRIGGERS)).toBe(true);
  });

  test('returns insufficient-data without firing actions', () => {
    const result = runStabilityTurbo([snapshot()], {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toEqual({
      protocolVersion: 1,
      turbo: SYSTEM_FACTS_STABILITY_TURBO_ID,
      turboVersion: 1,
      trigger: 'system.facts.request',
      generatedAt: '1970-01-01T00:00:00.000Z',
      sampleCount: 1,
      minimumSamples: 2,
      score: null,
      state: 'insufficient-data',
      trend: 'flat',
      volatility: null,
      dimensions: [],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('classifies a stable window', () => {
    const result = runStabilityTurbo(repeated(8), {
      trigger: 'health.interval',
      now: () => 1000
    });
    expect(result.score).toBe(100);
    expect(result.state).toBe('stable');
    expect(result.trend).toBe('flat');
    expect(result.volatility).toBe(0);
    expect(result.dimensions).toHaveLength(10);
  });

  test('classifies watch, unstable, rising, and falling windows', () => {
    const watchSamples = repeated(8).map((item, index) => ({
      ...item,
      cpu: { utilizationPercent: index % 2 === 0 ? 0 : 100 },
      memory: {
        usedPercent: index % 2 === 0 ? 0 : 100,
        swapUsedPercent: index % 2 === 0 ? 0 : 100
      },
      pressure: { ...item.pressure, cpu: index % 2 === 0 ? 'normal' : 'elevated' }
    }));
    const watch = runStabilityTurbo(watchSamples, { trigger: 'workload.changed', now: () => 0 });
    expect(watch.state).toBe('watch');

    const unstableSamples = repeated(8).map((item, index) => ({
      ...item,
      cpu: { utilizationPercent: index % 2 === 0 ? 0 : 100 },
      memory: { usedPercent: index % 2 === 0 ? 0 : 100, swapUsedPercent: index % 2 === 0 ? 0 : 100 },
      pressure: {
        cpu: index % 2 === 0 ? 'normal' : 'high',
        memory: index % 2 === 0 ? 'normal' : 'high',
        swap: index % 2 === 0 ? 'normal' : 'high',
        storage: index % 2 === 0 ? 'normal' : 'high'
      },
      storage: [{ usedPercent: index % 2 === 0 ? 0 : 100 }],
      gpus: index % 2 === 0 ? [] : [{}, {}, {}, {}],
      network: index % 2 === 0 ? [] : [{ mesh: true }, { mesh: true }, { mesh: true }, { mesh: true }]
    }));
    const unstable = runStabilityTurbo(unstableSamples, { trigger: 'health.interval', now: () => 0 });
    expect(unstable.state).toBe('unstable');

    const rising = runStabilityTurbo([
      snapshot({ cpu: { utilizationPercent: 0 } }),
      snapshot({ cpu: { utilizationPercent: 100 } })
    ], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 });
    expect(rising.trend).toBe('rising');

    const falling = runStabilityTurbo([
      snapshot({ cpu: { utilizationPercent: 100 } }),
      snapshot({ cpu: { utilizationPercent: 0 } })
    ], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 });
    expect(falling.trend).toBe('falling');
  });

  test('handles sparse and unknown measurements conservatively', () => {
    const result = runStabilityTurbo([
      snapshot({
        cpu: { utilizationPercent: 'bad' },
        memory: { usedPercent: 'bad', swapUsedPercent: 'bad' },
        pressure: { cpu: 'unknown', memory: 'unknown', swap: 'unknown', storage: 'unknown' },
        storage: undefined,
        gpus: undefined,
        network: undefined
      }),
      snapshot({
        cpu: {},
        memory: {},
        pressure: {},
        storage: [{ usedPercent: 120 }],
        gpus: [{}, {}, {}, {}, {}],
        network: [{ mesh: true }, {}, {}, {}, {}]
      })
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(result.score).not.toBeNull();
    expect(result.actions).toEqual([]);
  });

  test('bounds the sample window and accepts a one-sample minimum', () => {
    const result = runStabilityTurbo(repeated(20), {
      trigger: 'health.interval',
      windowSize: 4,
      minimumSamples: 1,
      now: () => 0
    });
    expect(result.sampleCount).toBe(4);
    expect(result.minimumSamples).toBe(1);
    expect(result.state).toBe('unstable');

    const single = runStabilityTurbo([snapshot()], {
      trigger: 'health.interval',
      minimumSamples: 1,
      now: () => 0
    });
    expect(single.trend).toBe('flat');
    expect(single.score).toBe(12.5);
  });

  test('rejects malformed inputs, triggers, limits, and clocks', () => {
    expect(() => runStabilityTurbo(null, { trigger: 'health.interval' }))
      .toThrow('Stability turbo samples must be an array');
    expect(() => runStabilityTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported stability turbo trigger: bad');
    expect(() => runStabilityTurbo([], {}))
      .toThrow('Unsupported stability turbo trigger: unknown');
    expect(() => runStabilityTurbo())
      .toThrow('Unsupported stability turbo trigger: unknown');
    expect(() => runStabilityTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runStabilityTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runStabilityTurbo([], { trigger: 'health.interval', windowSize: 2, minimumSamples: 3 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runStabilityTurbo([], { trigger: 'health.interval', windowSize: 2, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runStabilityTurbo([], { trigger: 'health.interval', now: () => NaN }))
      .toThrow('Stability turbo clock must return a number');
    expect(() => runStabilityTurbo([null, null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runStabilityTurbo([
      { engine: 'other' },
      { engine: 'other' }
    ], { trigger: 'health.interval' }))
      .toThrow('requires a system-facts snapshot');
    expect(() => runStabilityTurbo([
      snapshot({ cpu: null }),
      snapshot({ cpu: null })
    ], { trigger: 'health.interval' }))
      .toThrow('missing normalized sections');
  });
});
