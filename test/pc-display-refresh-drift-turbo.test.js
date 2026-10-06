import {
  DISPLAY_REFRESH_DRIFT_TRIGGERS,
  DISPLAY_REFRESH_DRIFT_TURBO_ID,
  DISPLAY_REFRESH_DRIFT_TURBO_VERSION,
  runDisplayRefreshDriftTurbo
} from '../pc/engines/display-pipeline/turbos/refresh-drift/turbo.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    refreshRateHz: 144,
    capabilities: { displayObservation: true },
    ...overrides
  };
}

const options = { trigger: 'health.interval', now: () => 0 };

describe('display-pipeline refresh-drift turbo', () => {
  test('publishes identity and detects refresh movement', () => {
    const result = runDisplayRefreshDriftTurbo([
      facts({ refreshRateHz: 60 }), facts({ refreshRateHz: 120 }), facts({ refreshRateHz: 144 })
    ], { ...options, deltaThreshold: 10, changeThreshold: 2 });
    expect(DISPLAY_REFRESH_DRIFT_TURBO_ID).toBe('display-pipeline.refresh-drift');
    expect(DISPLAY_REFRESH_DRIFT_TURBO_VERSION).toBe(1);
    expect(DISPLAY_REFRESH_DRIFT_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(result).toMatchObject({ turbo: DISPLAY_REFRESH_DRIFT_TURBO_ID, sampleCount: 3,
      observedCount: 3, deltaCount: 2, comparisonCount: 2, maximumDelta: 60,
      latestRefreshRateHz: 144, state: 'refresh-drift-sustained', confidence: 1,
      recommendations: ['review-refresh-stability', 'hold-unapproved-display-policy'] });
    expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('preserves every evidence state and recommendation', () => {
    expect(runDisplayRefreshDriftTurbo([], options)).toMatchObject({
      state: 'insufficient-data', sampleCount: 0, latestRefreshRateHz: null, confidence: 0,
      recommendations: ['collect-more-refresh-samples']
    });
    expect(runDisplayRefreshDriftTurbo([facts({ environment: 'headless' }),
      facts({ environment: 'headless' })], options)).toMatchObject({ state: 'no-display', noDisplayCount: 2 });
    expect(runDisplayRefreshDriftTurbo([facts({ capabilities: { displayObservation: false } }),
      facts({ capabilities: { displayObservation: false } })], options)).toMatchObject({
      state: 'no-observation', noObservationCount: 2, recommendations: ['request-refresh-observation']
    });
    expect(runDisplayRefreshDriftTurbo([facts({ refreshRateHz: null }),
      facts({ refreshRateHz: null })], options)).toMatchObject({
      state: 'incomplete-refresh-evidence', incompleteCount: 2,
      recommendations: ['request-complete-refresh-evidence']
    });
    expect(runDisplayRefreshDriftTurbo([facts({ environment: 'other' }),
      facts({ environment: 'other' })], options)).toMatchObject({ state: 'incomplete-refresh-evidence' });
    expect(runDisplayRefreshDriftTurbo([facts({ refreshRateHz: 60 }), facts({ refreshRateHz: 70 })],
      { ...options, deltaThreshold: 20, changeThreshold: 2 })).toMatchObject({
      state: 'stable-refresh', deltaCount: 0, recommendations: ['no-change']
    });
    expect(runDisplayRefreshDriftTurbo([facts({ refreshRateHz: 60 }), facts({ refreshRateHz: 70 })],
      { ...options, deltaThreshold: 5, changeThreshold: 2 })).toMatchObject({
      state: 'refresh-drift-observed', deltaCount: 1,
      recommendations: ['observe-next-refresh-sample']
    });
    expect(runDisplayRefreshDriftTurbo([facts(), facts()], options)).toMatchObject({
      state: 'stable-refresh', recommendations: ['no-change']
    });
  });

  test('applies window and default boundaries', () => {
    expect(runDisplayRefreshDriftTurbo([facts(), facts({ capabilities: { displayObservation: false } }),
      facts({ refreshRateHz: 120 })], { ...options, windowSize: 2, minimumSamples: 1 }))
      .toMatchObject({ sampleCount: 2, state: 'no-observation', noObservationCount: 1 });
    expect(runDisplayRefreshDriftTurbo(undefined, { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ sampleCount: 0, state: 'insufficient-data' });
    expect(runDisplayRefreshDriftTurbo([facts(), facts()], { trigger: 'health.interval' }))
      .toMatchObject({ state: 'stable-refresh', sampleCount: 2 });
  });

  test('rejects malformed inputs and unsafe bounds', () => {
    expect(() => runDisplayRefreshDriftTurbo()).toThrow('Unsupported');
    expect(() => runDisplayRefreshDriftTurbo([], { now: () => 0 })).toThrow('Unsupported');
    expect(() => runDisplayRefreshDriftTurbo(null, options)).toThrow('samples must be an array');
    expect(() => runDisplayRefreshDriftTurbo([], { ...options, windowSize: 0 })).toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runDisplayRefreshDriftTurbo([], { ...options, windowSize: 65 })).toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runDisplayRefreshDriftTurbo([], { ...options, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runDisplayRefreshDriftTurbo([], { ...options, windowSize: 1, minimumSamples: 2 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runDisplayRefreshDriftTurbo([], { ...options, deltaThreshold: -1 })).toThrow('deltaThreshold must be non-negative');
    expect(() => runDisplayRefreshDriftTurbo([], { ...options, changeThreshold: 0 })).toThrow('changeThreshold must be an integer from 1 to 64');
    expect(() => runDisplayRefreshDriftTurbo([null], options)).toThrow('snapshot must be an object');
    expect(() => runDisplayRefreshDriftTurbo([{}], options)).toThrow('requires a system-facts snapshot');
    expect(() => runDisplayRefreshDriftTurbo([], { ...options, now: () => NaN })).toThrow('clock must return a number');
  });
});
