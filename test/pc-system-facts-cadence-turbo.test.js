import {
  SYSTEM_FACTS_CADENCE_TRIGGERS,
  SYSTEM_FACTS_CADENCE_TURBO_ID,
  SYSTEM_FACTS_CADENCE_TURBO_VERSION,
  runCadenceTurbo
} from '../pc/engines/system-facts/turbos/cadence/turbo.js';

function snapshot(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    cpu: { utilizationPercent: 20 },
    memory: { usedPercent: 20, swapUsedPercent: 0 },
    storage: [{ usedPercent: 20 }],
    gpus: [],
    pressure: { cpu: 'normal', memory: 'normal', swap: 'normal', storage: 'normal' },
    capabilities: {
      gpuObservation: true,
      displayObservation: true,
      thermalObservation: true,
      powerProfileControl: true,
      processPriorityControl: true,
      ioPriorityControl: true,
      cacheCleanup: true,
      networkObservation: true
    },
    ...overrides
  };
}

function highSnapshot(overrides = {}) {
  return snapshot({
    cpu: { utilizationPercent: 95 },
    memory: { usedPercent: 95, swapUsedPercent: 95 },
    storage: [{ usedPercent: 95 }],
    gpus: [{ utilizationPercent: 95, temperatureCelsius: 80 }],
    pressure: { cpu: 'high', memory: 'high', swap: 'high', storage: 'high' },
    ...overrides
  });
}

describe('system-facts cadence turbo', () => {
  test('publishes identity and trigger policy', () => {
    expect(SYSTEM_FACTS_CADENCE_TURBO_ID).toBe('system-facts.cadence');
    expect(SYSTEM_FACTS_CADENCE_TURBO_VERSION).toBe(1);
    expect(SYSTEM_FACTS_CADENCE_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(SYSTEM_FACTS_CADENCE_TRIGGERS)).toBe(true);
  });

  test('selects a relaxed cadence for a stable low-pressure host', () => {
    const current = snapshot();
    const result = runCadenceTurbo(current, {
      trigger: 'system.facts.request',
      history: [current],
      now: () => 0
    });
    expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(result.state).toBe('relaxed');
    expect(result.pressure).toBeCloseTo(0.1875, 4);
    expect(result.volatility).toBe(0);
    expect(result.confidence).toBe(1);
    expect(result.factors).toEqual({ pressure: 1.5, stability: 1.35, confidence: 1.1, trigger: 1 });
    expect(result.schedule).toEqual({ intervalMs: 66825, minimumMs: 3000, maximumMs: 120000 });
    expect(result.boundary).toBe('interactive-observation-only');
    expect(result.recommendations).toEqual(['allow-longer-interval', 'keep-observation-only']);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('selects urgent cadence and manual review for high pressure', () => {
    const result = runCadenceTurbo(highSnapshot(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result.state).toBe('urgent');
    expect(result.pressure).toBeCloseTo(0.99, 2);
    expect(result.factors.pressure).toBe(0.5);
    expect(result.boundary).toBe('manual-review-required');
    expect(result.recommendations).toEqual(['sample-again-soon', 'hold-destructive-actions']);
    expect(result.schedule.intervalMs).toBeGreaterThanOrEqual(result.schedule.minimumMs);
  });

  test('responds quickly to a workload change on headless hosts', () => {
    const result = runCadenceTurbo(snapshot({
      environment: 'headless',
      cpu: { utilizationPercent: 60 },
      memory: { usedPercent: 60, swapUsedPercent: 20 },
      storage: [{ usedPercent: 60 }],
      pressure: { cpu: 'elevated', memory: 'elevated', swap: 'elevated', storage: 'elevated' },
      capabilities: { powerProfileControl: true }
    }), {
      trigger: 'workload.changed',
      now: () => 0
    });
    expect(result.state).toBe('responsive');
    expect(result.boundary).toBe('headless-observation-only');
    expect(result.recommendations).toEqual(['protect-services', 'sample-again-soon']);
    expect(result.factors.confidence).toBe(0.8);
    expect(result.factors.pressure).toBe(0.75);
    expect(result.factors.trigger).toBe(0.45);
    expect(result.schedule.minimumMs).toBe(5000);
    expect(result.schedule.maximumMs).toBe(300000);
  });

  test('covers mid pressure, volatile history, and interactive protection', () => {
    const current = snapshot({
      cpu: { utilizationPercent: 50 },
      memory: { usedPercent: 50, swapUsedPercent: 20 },
      storage: [{ usedPercent: 50 }],
      pressure: { cpu: 'unknown', memory: 'unknown', swap: 'unknown', storage: 'unknown' }
    });
    const result = runCadenceTurbo(current, {
      trigger: 'health.interval',
      history: [highSnapshot()],
      now: () => 0
    });
    expect(result.state).toBe('balanced');
    expect(result.volatility).toBeGreaterThan(0.7);
    expect(result.factors.pressure).toBe(1);
    expect(result.factors.stability).toBe(0.75);
    expect(result.factors.trigger).toBe(1.1);
    expect(result.recommendations).toEqual(['observe-at-selected-cadence']);
    expect(result.boundary).toBe('interactive-observation-only');

    const interactive = runCadenceTurbo(current, {
      trigger: 'workload.changed',
      now: () => 0
    });
    expect(interactive.state).toBe('responsive');
    expect(interactive.recommendations).toEqual(['protect-foreground', 'sample-again-soon']);
  });

  test('requires a profile for unknown environments and missing capabilities', () => {
    const result = runCadenceTurbo(snapshot({
      environment: 'unknown',
      cpu: {},
      memory: {},
      capabilities: undefined,
      storage: [],
      pressure: { cpu: 'mystery', memory: 'mystery', swap: 'mystery', storage: 'mystery' }
    }), {
      trigger: 'install.preflight',
      now: () => 0
    });
    expect(result.environment).toBe('unknown');
    expect(result.confidence).toBe(0.5);
    expect(result.factors.confidence).toBe(1);
    expect(result.factors.trigger).toBe(0.75);
    expect(result.boundary).toBe('profile-selection-required');
    expect(result.recommendations).toEqual([
      'request-environment-profile',
      'use-conservative-cadence'
    ]);
    expect(result.schedule).toEqual({ intervalMs: 11250, minimumMs: 5000, maximumMs: 60000 });

    const fallbackPolicy = runCadenceTurbo(snapshot({ environment: 'unclassified' }), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(fallbackPolicy.schedule.maximumMs).toBe(60000);
  });

  test('rejects malformed snapshots, history, triggers, and clocks', () => {
    expect(() => runCadenceTurbo(null, { trigger: 'system.facts.request' }))
      .toThrow('Cadence turbo snapshot must be an object');
    expect(() => runCadenceTurbo({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires a system-facts snapshot');
    expect(() => runCadenceTurbo({ engine: 'system-facts' }, { trigger: 'system.facts.request' }))
      .toThrow('missing normalized sections');
    expect(() => runCadenceTurbo(snapshot(), {
      trigger: 'system.facts.request',
      history: {}
    })).toThrow('history must be an array');
    expect(() => runCadenceTurbo(snapshot(), {
      trigger: 'system.facts.request',
      history: [null]
    })).toThrow('history contains an invalid snapshot');
    expect(() => runCadenceTurbo(snapshot(), { trigger: 'bad' }))
      .toThrow('Unsupported cadence turbo trigger: bad');
    expect(() => runCadenceTurbo(snapshot(), {}))
      .toThrow('Unsupported cadence turbo trigger: unknown');
    expect(() => runCadenceTurbo())
      .toThrow('Unsupported cadence turbo trigger: unknown');
    expect(() => runCadenceTurbo(snapshot(), {
      trigger: 'system.facts.request',
      now: () => Infinity
    })).toThrow('Cadence turbo clock must return a number');
  });
});
