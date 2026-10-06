import {
  FPS_TARGET_SOURCE_DRIFT_TRIGGERS,
  FPS_TARGET_SOURCE_DRIFT_TURBO_ID,
  FPS_TARGET_SOURCE_DRIFT_TURBO_VERSION,
  runFpsTargetSourceDriftTurbo
} from '../pc/engines/fps-target/turbos/target-source-drift/turbo.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    refreshRateHz: 144,
    fps: 120,
    userFpsTarget: null,
    capabilities: { displayObservation: true },
    ...overrides
  };
}

const options = { trigger: 'health.interval', now: () => 0 };

describe('fps-target target-source-drift turbo', () => {
  test('publishes identity and detects target provenance movement', () => {
    const result = runFpsTargetSourceDriftTurbo([
      facts(),
      facts({ userFpsTarget: 120 }),
      facts({ refreshRateHz: null, fps: 90, userFpsTarget: null })
    ], { ...options, changeThreshold: 2 });

    expect(FPS_TARGET_SOURCE_DRIFT_TURBO_ID).toBe('fps-target.target-source-drift');
    expect(FPS_TARGET_SOURCE_DRIFT_TURBO_VERSION).toBe(1);
    expect(FPS_TARGET_SOURCE_DRIFT_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(result).toMatchObject({
      turbo: FPS_TARGET_SOURCE_DRIFT_TURBO_ID,
      sampleCount: 3,
      observedCount: 3,
      userCount: 1,
      displayCount: 1,
      observationCount: 1,
      transitionCount: 2,
      comparisonCount: 2,
      latestSource: 'observation',
      latestTarget: 90,
      state: 'source-drift-sustained',
      confidence: 1,
      recommendations: ['review-target-provenance', 'hold-unapproved-fps-policy']
    });
    expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('preserves every evidence state and recommendation', () => {
    expect(runFpsTargetSourceDriftTurbo([], options)).toMatchObject({
      state: 'insufficient-data', sampleCount: 0, latestSource: 'unavailable', latestTarget: null,
      confidence: 0, recommendations: ['collect-more-target-source-samples']
    });
    expect(runFpsTargetSourceDriftTurbo([facts({ environment: 'headless' }),
      facts({ environment: 'headless' })], options)).toMatchObject({
      state: 'no-display', noDisplayCount: 2, recommendations: ['keep-fps-controls-disabled']
    });
    expect(runFpsTargetSourceDriftTurbo([facts({ capabilities: { displayObservation: false } }),
      facts({ capabilities: { displayObservation: false } })], options)).toMatchObject({
      state: 'no-observation', noObservationCount: 2,
      recommendations: ['request-fps-target-observation']
    });
    expect(runFpsTargetSourceDriftTurbo([facts({ refreshRateHz: null, fps: null }),
      facts({ refreshRateHz: null, fps: null })], options)).toMatchObject({
      state: 'incomplete-target-evidence', incompleteCount: 2,
      recommendations: ['request-target-source-evidence']
    });
    expect(runFpsTargetSourceDriftTurbo([
      facts({ refreshRateHz: 120, fps: 110 }), facts({ refreshRateHz: 120, fps: 100 })
    ], options)).toMatchObject({ state: 'stable-target-source', transitionCount: 0,
      recommendations: ['no-change'] });
    expect(runFpsTargetSourceDriftTurbo([
      facts(), facts({ userFpsTarget: 100 })
    ], { ...options, changeThreshold: 2 })).toMatchObject({
      state: 'source-drift-observed', transitionCount: 1,
      recommendations: ['observe-next-target-source']
    });
  });

  test('applies window, minimum, source, and movement boundaries', () => {
    expect(runFpsTargetSourceDriftTurbo(undefined, { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ sampleCount: 0, state: 'insufficient-data' });
    expect(runFpsTargetSourceDriftTurbo([facts(), facts()], { trigger: 'health.interval' }))
      .toMatchObject({ state: 'stable-target-source', sampleCount: 2 });
    const result = runFpsTargetSourceDriftTurbo([
      facts(), facts({ capabilities: { displayObservation: false } }),
      facts({ refreshRateHz: null, fps: 80 })
    ], { ...options, windowSize: 2, minimumSamples: 1 });
    expect(result).toMatchObject({ sampleCount: 2, state: 'no-observation', noObservationCount: 1,
      observationCount: 1, comparisonCount: 0, transitionCount: 0 });
    expect(runFpsTargetSourceDriftTurbo([facts({ refreshRateHz: null, fps: 80 }),
      facts({ refreshRateHz: null, fps: null, userFpsTarget: 75 })], options))
      .toMatchObject({ userCount: 1, observationCount: 1, latestSource: 'user', latestTarget: 75 });
    expect(runFpsTargetSourceDriftTurbo([facts({ environment: 'other' }), facts({ environment: 'other' })], options))
      .toMatchObject({ state: 'incomplete-target-evidence', confidence: 0 });
  });

  test('rejects malformed inputs and unsafe bounds', () => {
    expect(() => runFpsTargetSourceDriftTurbo()).toThrow('Unsupported');
    expect(() => runFpsTargetSourceDriftTurbo([], { now: () => 0 })).toThrow('Unsupported');
    expect(() => runFpsTargetSourceDriftTurbo(null, options)).toThrow('samples must be an array');
    expect(() => runFpsTargetSourceDriftTurbo([], { ...options, windowSize: 0 }))
      .toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runFpsTargetSourceDriftTurbo([], { ...options, windowSize: 65 }))
      .toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runFpsTargetSourceDriftTurbo([], { ...options, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runFpsTargetSourceDriftTurbo([], { ...options, windowSize: 1, minimumSamples: 2 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runFpsTargetSourceDriftTurbo([], { ...options, changeThreshold: 0 }))
      .toThrow('changeThreshold must be an integer from 1 to 64');
    expect(() => runFpsTargetSourceDriftTurbo([], { ...options, changeThreshold: 65 }))
      .toThrow('changeThreshold must be an integer from 1 to 64');
    expect(() => runFpsTargetSourceDriftTurbo([null], options)).toThrow('snapshot must be an object');
    expect(() => runFpsTargetSourceDriftTurbo([{}], options)).toThrow('requires a system-facts snapshot');
    expect(() => runFpsTargetSourceDriftTurbo([], { ...options, now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
