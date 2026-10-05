import {
  FPS_TARGET_ENGINE_ID,
  FPS_TARGET_ENGINE_VERSION,
  FPS_TARGET_TRIGGERS,
  runFpsTargetEngine
} from '../pc/engines/fps-target/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    capabilities: { displayObservation: true },
    refreshRateHz: 144,
    fps: 120,
    userFpsTarget: undefined,
    ...overrides
  };
}

describe('FPS-target engine', () => {
  test('publishes identity and triggers', () => {
    expect(FPS_TARGET_ENGINE_ID).toBe('fps-target');
    expect(FPS_TARGET_ENGINE_VERSION).toBe(1);
    expect(FPS_TARGET_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(FPS_TARGET_TRIGGERS)).toBe(true);
  });

  test('uses documented display refresh without applying a target', () => {
    const result = runFpsTargetEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: FPS_TARGET_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      refreshRateHz: 144,
      observedFps: 120,
      userFpsTarget: null,
      candidateFpsTarget: 144,
      targetSource: 'display',
      targetGap: 24,
      observationEnabled: true,
      state: 'headroom-required',
      confidence: 0.8,
      recommendations: ['hold-target-below-observed-capability'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('preserves and bounds a user-owned target', () => {
    expect(runFpsTargetEngine(facts({ userFpsTarget: 100 }), {
      trigger: 'workload.changed',
      now: () => 0
    })).toMatchObject({
      candidateFpsTarget: 100,
      targetSource: 'user',
      targetGap: -20,
      state: 'user-target',
      confidence: 1,
      recommendations: ['preserve-user-fps-target']
    });
    expect(runFpsTargetEngine(facts({ userFpsTarget: 240 }), {
      trigger: 'health.interval',
      now: () => 0
    }).candidateFpsTarget).toBe(144);
    expect(runFpsTargetEngine(facts({
      refreshRateHz: undefined,
      fps: undefined,
      userFpsTarget: 75
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      candidateFpsTarget: 75,
      targetSource: 'user',
      state: 'user-target'
    });
  });

  test('uses observed FPS when display refresh is unavailable', () => {
    expect(runFpsTargetEngine(facts({
      refreshRateHz: undefined,
      fps: 60
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      refreshRateHz: null,
      observedFps: 60,
      candidateFpsTarget: 60,
      targetSource: 'observation',
      targetGap: 0,
      state: 'observe',
      recommendations: ['no-change']
    });
    expect(runFpsTargetEngine(facts({
      fps: undefined
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      candidateFpsTarget: 144,
      targetSource: 'display',
      state: 'display-target',
      recommendations: ['observe-before-applying-target']
    });
  });

  test('handles disabled observation, headless, and missing target evidence', () => {
    expect(runFpsTargetEngine(facts({
      capabilities: { displayObservation: false }
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      state: 'observation-disabled',
      recommendations: ['keep-fps-observation-disabled']
    });
    expect(runFpsTargetEngine(facts({
      environment: 'headless'
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      state: 'no-display',
      recommendations: ['keep-fps-controls-disabled']
    });
    expect(runFpsTargetEngine(facts({
      refreshRateHz: undefined,
      fps: undefined
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      candidateFpsTarget: null,
      targetSource: 'unavailable',
      targetGap: null,
      state: 'target-required',
      confidence: 0.2,
      recommendations: ['request-refresh-or-fps-observation']
    });
  });

  test('requires a known environment and rejects malformed inputs', () => {
    expect(runFpsTargetEngine(facts({
      environment: 'other',
      refreshRateHz: undefined,
      fps: undefined
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(runFpsTargetEngine(facts({
      refreshRateHz: -1,
      fps: 0,
      userFpsTarget: 0
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      refreshRateHz: null,
      observedFps: null,
      userFpsTarget: null,
      candidateFpsTarget: null
    });
    expect(() => runFpsTargetEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runFpsTargetEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runFpsTargetEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported FPS-target trigger: bad');
    expect(() => runFpsTargetEngine(facts(), {}))
      .toThrow('Unsupported FPS-target trigger: unknown');
    expect(() => runFpsTargetEngine())
      .toThrow('Unsupported FPS-target trigger: unknown');
    expect(() => runFpsTargetEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('FPS-target clock must return a number');
  });
});
