import {
  MEMORY_PRESSURE_ENGINE_ID,
  MEMORY_PRESSURE_ENGINE_VERSION,
  MEMORY_PRESSURE_TRIGGERS,
  runMemoryPressureEngine
} from '../pc/engines/memory-pressure/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    memory: {
      totalBytes: 100,
      availableBytes: 70,
      usedPercent: 30,
      swapUsedPercent: 0
    },
    ...overrides
  };
}

describe('memory-pressure engine', () => {
  test('publishes identity and triggers', () => {
    expect(MEMORY_PRESSURE_ENGINE_ID).toBe('memory-pressure');
    expect(MEMORY_PRESSURE_ENGINE_VERSION).toBe(1);
    expect(MEMORY_PRESSURE_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(MEMORY_PRESSURE_TRIGGERS)).toBe(true);
  });

  test('reports normal memory pressure and headroom', () => {
    const result = runMemoryPressureEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: MEMORY_PRESSURE_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      usedPercent: 30,
      headroomPercent: 70,
      totalBytes: 100,
      availableBytes: 70,
      swapUsedPercent: 0,
      level: 'normal',
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('reports elevated pressure with conservative review guidance', () => {
    expect(runMemoryPressureEngine(facts({
      memory: { totalBytes: 100, availableBytes: 20, usedPercent: 80, swapUsedPercent: 40 }
    }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      level: 'elevated',
      state: 'watch',
      recommendations: ['observe-next-sample', 'review-approved-memory-policy']
    });
  });

  test('protects headless services at high pressure', () => {
    expect(runMemoryPressureEngine(facts({
      environment: 'headless',
      memory: { totalBytes: 100, availableBytes: 5, usedPercent: 95, swapUsedPercent: 90 }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      environment: 'headless',
      level: 'high',
      state: 'protect-services',
      recommendations: ['protect-services', 'hold-destructive-actions']
    });
    expect(runMemoryPressureEngine(facts({
      memory: { totalBytes: 100, availableBytes: 5, usedPercent: 95, swapUsedPercent: 90 }
    }), { trigger: 'health.interval', now: () => 0 }).state).toBe('protect-foreground');
  });

  test('reports unknown memory evidence and environment conservatively', () => {
    const result = runMemoryPressureEngine(facts({
      environment: 'other',
      memory: {}
    }), { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({
      environment: 'unknown',
      usedPercent: null,
      headroomPercent: null,
      totalBytes: null,
      availableBytes: null,
      swapUsedPercent: null,
      level: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(runMemoryPressureEngine(facts({ memory: {} }), {
      trigger: 'system.facts.request',
      now: () => 0
    }).recommendations).toEqual(['request-memory-observation']);
  });

  test('clamps numeric observations and rejects malformed inputs', () => {
    expect(runMemoryPressureEngine(facts({ memory: {
      totalBytes: -1,
      availableBytes: 200,
      usedPercent: 120,
      swapUsedPercent: -5
    } }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      usedPercent: 100,
      headroomPercent: 0,
      totalBytes: null,
      availableBytes: 200,
      swapUsedPercent: 0,
      level: 'high'
    });
    expect(() => runMemoryPressureEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runMemoryPressureEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runMemoryPressureEngine(facts({ memory: null }), { trigger: 'system.facts.request' }))
      .toThrow('require a memory section');
    expect(() => runMemoryPressureEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported memory-pressure trigger: bad');
    expect(() => runMemoryPressureEngine(facts(), {}))
      .toThrow('Unsupported memory-pressure trigger: unknown');
    expect(() => runMemoryPressureEngine())
      .toThrow('Unsupported memory-pressure trigger: unknown');
    expect(() => runMemoryPressureEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Memory-pressure clock must return a number');
  });
});
