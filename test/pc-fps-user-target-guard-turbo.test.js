import {
  FPS_USER_TARGET_GUARD_TRIGGERS,
  FPS_USER_TARGET_GUARD_TURBO_ID,
  FPS_USER_TARGET_GUARD_TURBO_VERSION,
  runFpsUserTargetGuardTurbo
} from '../pc/engines/fps-target/turbos/user-target-guard/turbo.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    refreshRateHz: 144,
    userFpsTarget: 120,
    capabilities: { displayObservation: true },
    ...overrides
  };
}

const options = { trigger: 'health.interval', now: () => 0 };

describe('fps-target user-target-guard turbo', () => {
  test('publishes identity and detects sustained over-refresh targets', () => {
    const result = runFpsUserTargetGuardTurbo([
      facts({ userFpsTarget: 240 }), facts({ userFpsTarget: 200 }), facts({ userFpsTarget: 180 })
    ], { ...options, persistenceThreshold: 2 });

    expect(FPS_USER_TARGET_GUARD_TURBO_ID).toBe('fps-target.user-target-guard');
    expect(FPS_USER_TARGET_GUARD_TURBO_VERSION).toBe(1);
    expect(FPS_USER_TARGET_GUARD_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(result).toMatchObject({
      turbo: FPS_USER_TARGET_GUARD_TURBO_ID,
      sampleCount: 3,
      observedCount: 3,
      overRefreshCount: 3,
      minimumUserTarget: 180,
      maximumUserTarget: 240,
      state: 'target-over-refresh-sustained',
      confidence: 1,
      recommendations: ['review-user-target-against-refresh', 'preserve-user-intent']
    });
    expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('preserves every evidence state and recommendation', () => {
    expect(runFpsUserTargetGuardTurbo([], options)).toMatchObject({
      state: 'insufficient-data', sampleCount: 0, minimumUserTarget: null,
      maximumUserTarget: null, confidence: 0, recommendations: ['collect-more-user-target-samples']
    });
    expect(runFpsUserTargetGuardTurbo([facts({ environment: 'headless' }),
      facts({ environment: 'headless' })], options)).toMatchObject({
      state: 'no-display', noDisplayCount: 2, recommendations: ['keep-fps-controls-disabled']
    });
    expect(runFpsUserTargetGuardTurbo([facts({ capabilities: { displayObservation: false } }),
      facts({ capabilities: { displayObservation: false } })], options)).toMatchObject({
      state: 'no-observation', noObservationCount: 2,
      recommendations: ['keep-user-target-observation-disabled']
    });
    expect(runFpsUserTargetGuardTurbo([facts({ environment: 'other' }),
      facts({ environment: 'other' })], options)).toMatchObject({
      state: 'incomplete-user-target-evidence', incompleteCount: 2,
      recommendations: ['request-complete-user-target-evidence']
    });
    expect(runFpsUserTargetGuardTurbo([facts({ userFpsTarget: null }),
      facts({ userFpsTarget: null })], options)).toMatchObject({
      state: 'no-user-target', missingCount: 2, recommendations: ['preserve-no-user-target-state']
    });
    expect(runFpsUserTargetGuardTurbo([facts(), facts({ userFpsTarget: null })], options))
      .toMatchObject({ state: 'incomplete-user-target-evidence', missingCount: 1 });
    expect(runFpsUserTargetGuardTurbo([facts({ refreshRateHz: null })],
      { ...options, minimumSamples: 1 })).toMatchObject({
      state: 'target-without-display', withoutDisplayCount: 1,
      recommendations: ['observe-display-before-comparing-target']
    });
    expect(runFpsUserTargetGuardTurbo([facts({ userFpsTarget: 200 }), facts({ userFpsTarget: 180 })],
      { ...options, persistenceThreshold: 3 })).toMatchObject({
      state: 'target-over-refresh-observed', recommendations: ['observe-next-user-target']
    });
    expect(runFpsUserTargetGuardTurbo([facts({ userFpsTarget: 120 }), facts({ userFpsTarget: 100 })], options))
      .toMatchObject({ state: 'user-target-preserved', recommendations: ['no-change'] });
  });

  test('applies window and default boundaries', () => {
    const result = runFpsUserTargetGuardTurbo([
      facts({ userFpsTarget: 200 }), facts({ capabilities: { displayObservation: false } }),
      facts({ userFpsTarget: 120 })
    ], { ...options, windowSize: 2, minimumSamples: 1 });
    expect(result).toMatchObject({ sampleCount: 2, state: 'no-observation',
      noObservationCount: 1, observedCount: 1 });
    expect(runFpsUserTargetGuardTurbo(undefined, { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ sampleCount: 0, state: 'insufficient-data' });
    expect(runFpsUserTargetGuardTurbo([facts(), facts()], { trigger: 'health.interval' }))
      .toMatchObject({ state: 'user-target-preserved', sampleCount: 2 });
  });

  test('rejects malformed inputs and unsafe bounds', () => {
    expect(() => runFpsUserTargetGuardTurbo()).toThrow('Unsupported');
    expect(() => runFpsUserTargetGuardTurbo([], { now: () => 0 })).toThrow('Unsupported');
    expect(() => runFpsUserTargetGuardTurbo(null, options)).toThrow('samples must be an array');
    expect(() => runFpsUserTargetGuardTurbo([], { ...options, windowSize: 0 }))
      .toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runFpsUserTargetGuardTurbo([], { ...options, windowSize: 65 }))
      .toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runFpsUserTargetGuardTurbo([], { ...options, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runFpsUserTargetGuardTurbo([], { ...options, windowSize: 1, minimumSamples: 2 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runFpsUserTargetGuardTurbo([], { ...options, persistenceThreshold: 0 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 64');
    expect(() => runFpsUserTargetGuardTurbo([null], options)).toThrow('snapshot must be an object');
    expect(() => runFpsUserTargetGuardTurbo([{}], options)).toThrow('requires a system-facts snapshot');
    expect(() => runFpsUserTargetGuardTurbo([], { ...options, now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
