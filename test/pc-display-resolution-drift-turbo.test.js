import {
  DISPLAY_RESOLUTION_DRIFT_TRIGGERS,
  DISPLAY_RESOLUTION_DRIFT_TURBO_ID,
  DISPLAY_RESOLUTION_DRIFT_TURBO_VERSION,
  runDisplayResolutionDriftTurbo
} from '../pc/engines/display-pipeline/turbos/resolution-drift/turbo.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    resolutionWidth: 1920,
    resolutionHeight: 1080,
    capabilities: { displayObservation: true },
    ...overrides
  };
}

const options = { trigger: 'health.interval', now: () => 0 };

describe('display-pipeline resolution-drift turbo', () => {
  test('publishes identity and detects resolution movement', () => {
    const result = runDisplayResolutionDriftTurbo([
      facts(), facts({ resolutionWidth: 2560, resolutionHeight: 1440 }),
      facts({ resolutionWidth: 3840, resolutionHeight: 2160 })
    ], { ...options, changeThreshold: 2 });
    expect(DISPLAY_RESOLUTION_DRIFT_TURBO_ID).toBe('display-pipeline.resolution-drift');
    expect(DISPLAY_RESOLUTION_DRIFT_TURBO_VERSION).toBe(1);
    expect(DISPLAY_RESOLUTION_DRIFT_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(result).toMatchObject({
      turbo: DISPLAY_RESOLUTION_DRIFT_TURBO_ID, sampleCount: 3, observedCount: 3,
      transitionCount: 2, comparisonCount: 2, latestResolution: '3840x2160',
      latestWidth: 3840, latestHeight: 2160, state: 'resolution-drift-sustained', confidence: 1,
      recommendations: ['review-resolution-workload', 'hold-unapproved-display-policy']
    });
    expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('preserves every evidence state and recommendation', () => {
    expect(runDisplayResolutionDriftTurbo([], options)).toMatchObject({
      state: 'insufficient-data', sampleCount: 0, latestResolution: null, confidence: 0,
      recommendations: ['collect-more-resolution-samples']
    });
    expect(runDisplayResolutionDriftTurbo([facts({ environment: 'headless' }),
      facts({ environment: 'headless' })], options)).toMatchObject({
      state: 'no-display', noDisplayCount: 2, recommendations: ['keep-display-controls-disabled']
    });
    expect(runDisplayResolutionDriftTurbo([facts({ capabilities: { displayObservation: false } }),
      facts({ capabilities: { displayObservation: false } })], options)).toMatchObject({
      state: 'no-observation', noObservationCount: 2, recommendations: ['request-resolution-observation']
    });
    expect(runDisplayResolutionDriftTurbo([facts({ resolutionWidth: null }),
      facts({ resolutionHeight: null })], options)).toMatchObject({
      state: 'incomplete-resolution-evidence', incompleteCount: 2,
      recommendations: ['request-complete-resolution-evidence']
    });
    expect(runDisplayResolutionDriftTurbo([facts({ environment: 'other' }),
      facts({ environment: 'other' })], options)).toMatchObject({
      state: 'incomplete-resolution-evidence', incompleteCount: 2
    });
    expect(runDisplayResolutionDriftTurbo([facts(), facts({ resolutionWidth: 2560 })],
      { ...options, changeThreshold: 2 })).toMatchObject({
      state: 'resolution-drift-observed', transitionCount: 1,
      recommendations: ['observe-next-resolution-sample']
    });
    expect(runDisplayResolutionDriftTurbo([facts(), facts()], options)).toMatchObject({
      state: 'stable-resolution', recommendations: ['no-change']
    });
  });

  test('applies window and default boundaries', () => {
    expect(runDisplayResolutionDriftTurbo([facts(), facts({ capabilities: { displayObservation: false } }),
      facts({ resolutionWidth: 2560 })], { ...options, windowSize: 2, minimumSamples: 1 }))
      .toMatchObject({ sampleCount: 2, state: 'no-observation', noObservationCount: 1 });
    expect(runDisplayResolutionDriftTurbo(undefined, { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ sampleCount: 0, state: 'insufficient-data' });
    expect(runDisplayResolutionDriftTurbo([facts(), facts()], { trigger: 'health.interval' }))
      .toMatchObject({ state: 'stable-resolution', sampleCount: 2 });
  });

  test('rejects malformed inputs and unsafe bounds', () => {
    expect(() => runDisplayResolutionDriftTurbo()).toThrow('Unsupported');
    expect(() => runDisplayResolutionDriftTurbo([], { now: () => 0 })).toThrow('Unsupported');
    expect(() => runDisplayResolutionDriftTurbo(null, options)).toThrow('samples must be an array');
    expect(() => runDisplayResolutionDriftTurbo([], { ...options, windowSize: 0 }))
      .toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runDisplayResolutionDriftTurbo([], { ...options, windowSize: 65 }))
      .toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runDisplayResolutionDriftTurbo([], { ...options, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runDisplayResolutionDriftTurbo([], { ...options, windowSize: 1, minimumSamples: 2 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runDisplayResolutionDriftTurbo([], { ...options, changeThreshold: 0 }))
      .toThrow('changeThreshold must be an integer from 1 to 64');
    expect(() => runDisplayResolutionDriftTurbo([null], options)).toThrow('snapshot must be an object');
    expect(() => runDisplayResolutionDriftTurbo([{}], options)).toThrow('requires a system-facts snapshot');
    expect(() => runDisplayResolutionDriftTurbo([], { ...options, now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
