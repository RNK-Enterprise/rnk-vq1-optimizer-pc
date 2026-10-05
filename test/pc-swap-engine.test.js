import {
  SWAP_ENGINE_ID,
  SWAP_ENGINE_VERSION,
  SWAP_TRIGGERS,
  runSwapEngine
} from '../pc/engines/swap/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    memory: {
      swapTotalBytes: 100,
      swapFreeBytes: 80,
      swapUsedPercent: 20
    },
    ...overrides
  };
}

describe('swap engine', () => {
  test('publishes identity and triggers', () => {
    expect(SWAP_ENGINE_ID).toBe('swap');
    expect(SWAP_ENGINE_VERSION).toBe(1);
    expect(SWAP_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(SWAP_TRIGGERS)).toBe(true);
  });

  test('reports normal swap usage without changes', () => {
    const result = runSwapEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: SWAP_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      totalBytes: 100,
      freeBytes: 80,
      usedPercent: 20,
      state: 'normal',
      operatingState: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('reports elevated and high swap pressure conservatively', () => {
    expect(runSwapEngine(facts({ memory: {
      swapTotalBytes: 100, swapFreeBytes: 50, swapUsedPercent: 50
    } }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      state: 'elevated',
      operatingState: 'review',
      recommendations: ['observe-next-sample', 'review-documented-swap-policy']
    });
    expect(runSwapEngine(facts({ memory: {
      swapTotalBytes: 100, swapFreeBytes: 10, swapUsedPercent: 90
    } }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      state: 'high',
      operatingState: 'hold-destructive-actions',
      recommendations: ['hold-destructive-actions', 'review-memory-pressure']
    });
  });

  test('treats no-swap hosts as explicit user-owned state', () => {
    const result = runSwapEngine(facts({
      environment: 'headless',
      memory: { swapTotalBytes: 0, swapFreeBytes: 0, swapUsedPercent: null }
    }), { trigger: 'install.preflight', now: () => 0 });
    expect(result).toMatchObject({
      environment: 'headless',
      state: 'none',
      operatingState: 'observe-no-swap',
      recommendations: ['no-change', 'keep-no-swap-user-owned']
    });
  });

  test('reports unknown swap and environment conservatively', () => {
    const result = runSwapEngine(facts({
      environment: 'other',
      memory: {}
    }), { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({
      environment: 'unknown',
      totalBytes: null,
      freeBytes: null,
      usedPercent: null,
      state: 'unknown',
      operatingState: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(runSwapEngine(facts({ memory: {} }), {
      trigger: 'system.facts.request',
      now: () => 0
    }).recommendations).toEqual(['request-swap-observation']);
  });

  test('clamps numeric observations and rejects malformed inputs', () => {
    expect(runSwapEngine(facts({ memory: {
      swapTotalBytes: -1,
      swapFreeBytes: 200,
      swapUsedPercent: 120
    } }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      totalBytes: null,
      freeBytes: 200,
      usedPercent: 100,
      state: 'unknown'
    });
    expect(() => runSwapEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runSwapEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runSwapEngine(facts({ memory: null }), { trigger: 'system.facts.request' }))
      .toThrow('require a memory section');
    expect(() => runSwapEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported swap trigger: bad');
    expect(() => runSwapEngine(facts(), {}))
      .toThrow('Unsupported swap trigger: unknown');
    expect(() => runSwapEngine())
      .toThrow('Unsupported swap trigger: unknown');
    expect(() => runSwapEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Swap clock must return a number');
  });
});
