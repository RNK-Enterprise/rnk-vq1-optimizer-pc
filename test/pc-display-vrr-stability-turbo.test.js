import {
  DISPLAY_VRR_STABILITY_TRIGGERS,
  DISPLAY_VRR_STABILITY_TURBO_ID,
  DISPLAY_VRR_STABILITY_TURBO_VERSION,
  runDisplayVrrStabilityTurbo
} from '../pc/engines/display-pipeline/turbos/vrr-stability/turbo.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    vrr: true,
    capabilities: { displayObservation: true },
    ...overrides
  };
}

const options = { trigger: 'health.interval', now: () => 0 };

describe('display-pipeline vrr-stability turbo', () => {
  test('publishes identity and detects VRR movement', () => {
    const result = runDisplayVrrStabilityTurbo([
      facts({ vrr: true }), facts({ vrr: false }), facts({ vrr: true })
    ], { ...options, changeThreshold: 2 });
    expect(DISPLAY_VRR_STABILITY_TURBO_ID).toBe('display-pipeline.vrr-stability');
    expect(DISPLAY_VRR_STABILITY_TURBO_VERSION).toBe(1);
    expect(DISPLAY_VRR_STABILITY_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(result).toMatchObject({ turbo: DISPLAY_VRR_STABILITY_TURBO_ID, sampleCount: 3,
      observedCount: 3, enabledCount: 2, disabledCount: 1, transitionCount: 2,
      comparisonCount: 2, latestVrr: true, state: 'vrr-drift-sustained', confidence: 1,
      recommendations: ['review-vrr-stability', 'hold-unapproved-display-policy'] });
    expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('preserves every evidence state and recommendation', () => {
    expect(runDisplayVrrStabilityTurbo([], options)).toMatchObject({
      state: 'insufficient-data', sampleCount: 0, latestVrr: null, confidence: 0,
      recommendations: ['collect-more-vrr-samples']
    });
    expect(runDisplayVrrStabilityTurbo([facts({ environment: 'headless' }),
      facts({ environment: 'headless' })], options)).toMatchObject({ state: 'no-display', noDisplayCount: 2 });
    expect(runDisplayVrrStabilityTurbo([facts({ capabilities: { displayObservation: false } }),
      facts({ capabilities: { displayObservation: false } })], options)).toMatchObject({
      state: 'no-observation', noObservationCount: 2, recommendations: ['request-vrr-observation']
    });
    expect(runDisplayVrrStabilityTurbo([facts({ vrr: null }), facts({ vrr: null })], options)).toMatchObject({
      state: 'incomplete-vrr-evidence', incompleteCount: 2, recommendations: ['request-complete-vrr-evidence']
    });
    expect(runDisplayVrrStabilityTurbo([facts({ environment: 'other' }), facts({ environment: 'other' })], options))
      .toMatchObject({ state: 'incomplete-vrr-evidence' });
    expect(runDisplayVrrStabilityTurbo([facts({ vrr: true }), facts({ vrr: false })],
      { ...options, changeThreshold: 2 })).toMatchObject({ state: 'vrr-drift-observed', transitionCount: 1,
      recommendations: ['observe-next-vrr-sample'] });
    expect(runDisplayVrrStabilityTurbo([facts({ vrr: true }), facts({ vrr: true })], options))
      .toMatchObject({ state: 'vrr-stable-enabled', recommendations: ['preserve-observed-vrr-state'] });
    expect(runDisplayVrrStabilityTurbo([facts({ vrr: false }), facts({ vrr: false })], options))
      .toMatchObject({ state: 'vrr-stable-disabled', recommendations: ['preserve-observed-fixed-refresh-state'] });
  });

  test('applies window and default boundaries', () => {
    expect(runDisplayVrrStabilityTurbo([facts(), facts({ capabilities: { displayObservation: false } }),
      facts({ vrr: false })], { ...options, windowSize: 2, minimumSamples: 1 }))
      .toMatchObject({ sampleCount: 2, state: 'no-observation', noObservationCount: 1 });
    expect(runDisplayVrrStabilityTurbo(undefined, { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ sampleCount: 0, state: 'insufficient-data' });
    expect(runDisplayVrrStabilityTurbo([facts(), facts()], { trigger: 'health.interval' }))
      .toMatchObject({ state: 'vrr-stable-enabled', sampleCount: 2 });
  });

  test('rejects malformed inputs and unsafe bounds', () => {
    expect(() => runDisplayVrrStabilityTurbo()).toThrow('Unsupported');
    expect(() => runDisplayVrrStabilityTurbo([], { now: () => 0 })).toThrow('Unsupported');
    expect(() => runDisplayVrrStabilityTurbo(null, options)).toThrow('samples must be an array');
    expect(() => runDisplayVrrStabilityTurbo([], { ...options, windowSize: 0 })).toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runDisplayVrrStabilityTurbo([], { ...options, windowSize: 65 })).toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runDisplayVrrStabilityTurbo([], { ...options, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runDisplayVrrStabilityTurbo([], { ...options, windowSize: 1, minimumSamples: 2 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runDisplayVrrStabilityTurbo([], { ...options, changeThreshold: 0 })).toThrow('changeThreshold must be an integer from 1 to 64');
    expect(() => runDisplayVrrStabilityTurbo([null], options)).toThrow('snapshot must be an object');
    expect(() => runDisplayVrrStabilityTurbo([{}], options)).toThrow('requires a system-facts snapshot');
    expect(() => runDisplayVrrStabilityTurbo([], { ...options, now: () => NaN })).toThrow('clock must return a number');
  });
});
