import {
  FPS_REFRESH_HEADROOM_TRIGGERS,
  FPS_REFRESH_HEADROOM_TURBO_ID,
  FPS_REFRESH_HEADROOM_TURBO_VERSION,
  runFpsRefreshHeadroomTurbo
} from '../pc/engines/fps-target/turbos/refresh-headroom/turbo.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    refreshRateHz: 144,
    fps: 140,
    capabilities: { displayObservation: true },
    ...overrides
  };
}

const options = { trigger: 'health.interval', now: () => 0 };

describe('fps-target refresh-headroom turbo', () => {
  test('publishes identity and measures headroom collapse', () => {
    const result = runFpsRefreshHeadroomTurbo([
      facts({ fps: 140 }), facts({ fps: 143 }), facts({ fps: 142 })
    ], { ...options, minimumHeadroom: 3, persistenceThreshold: 2 });

    expect(FPS_REFRESH_HEADROOM_TURBO_ID).toBe('fps-target.refresh-headroom');
    expect(FPS_REFRESH_HEADROOM_TURBO_VERSION).toBe(1);
    expect(FPS_REFRESH_HEADROOM_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(result).toMatchObject({
      turbo: FPS_REFRESH_HEADROOM_TURBO_ID,
      sampleCount: 3,
      observedCount: 3,
      tightCount: 2,
      minimumObservedHeadroom: 1,
      maximumObservedHeadroom: 4,
      state: 'headroom-collapse-sustained',
      confidence: 1,
      recommendations: ['review-refresh-headroom', 'hold-unapproved-fps-policy']
    });
    expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('preserves every evidence state and recommendation', () => {
    expect(runFpsRefreshHeadroomTurbo([], options)).toMatchObject({
      state: 'insufficient-data', sampleCount: 0, minimumObservedHeadroom: null,
      maximumObservedHeadroom: null, confidence: 0,
      recommendations: ['collect-more-refresh-headroom-samples']
    });
    expect(runFpsRefreshHeadroomTurbo([facts({ environment: 'headless' }),
      facts({ environment: 'headless' })], options)).toMatchObject({
      state: 'no-display', noDisplayCount: 2, recommendations: ['keep-fps-controls-disabled']
    });
    expect(runFpsRefreshHeadroomTurbo([facts({ capabilities: { displayObservation: false } }),
      facts({ capabilities: { displayObservation: false } })], options)).toMatchObject({
      state: 'no-observation', noObservationCount: 2,
      recommendations: ['request-refresh-headroom-observation']
    });
    expect(runFpsRefreshHeadroomTurbo([facts({ refreshRateHz: null }),
      facts({ fps: null })], options)).toMatchObject({
      state: 'incomplete-headroom-evidence', incompleteCount: 2,
      recommendations: ['request-refresh-and-fps-evidence']
    });
    expect(runFpsRefreshHeadroomTurbo([facts({ fps: 130 }), facts({ fps: 120 })], options))
      .toMatchObject({ state: 'headroom-available', tightCount: 0, recommendations: ['no-change'] });
    expect(runFpsRefreshHeadroomTurbo([facts({ fps: 143 }), facts({ fps: 142 })],
      { ...options, minimumHeadroom: 3, persistenceThreshold: 3 })).toMatchObject({
      state: 'headroom-collapse-observed', tightCount: 2,
      recommendations: ['observe-next-headroom-sample']
    });
  });

  test('applies window, threshold, and environment boundaries', () => {
    const result = runFpsRefreshHeadroomTurbo([
      facts({ fps: 140 }), facts({ capabilities: { displayObservation: false } }),
      facts({ fps: 142 })
    ], { ...options, windowSize: 2, minimumSamples: 1 });
    expect(result).toMatchObject({ sampleCount: 2, state: 'no-observation',
      noObservationCount: 1, observedCount: 1, minimumObservedHeadroom: 2 });
    expect(runFpsRefreshHeadroomTurbo([facts({ environment: 'other' }),
      facts({ environment: 'other' })], options)).toMatchObject({
      state: 'incomplete-headroom-evidence', confidence: 0
    });
    expect(runFpsRefreshHeadroomTurbo(undefined, { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ sampleCount: 0, state: 'insufficient-data' });
    expect(runFpsRefreshHeadroomTurbo([facts(), facts()], { trigger: 'health.interval' }))
      .toMatchObject({ state: 'headroom-available', sampleCount: 2 });
  });

  test('rejects malformed inputs and unsafe bounds', () => {
    expect(() => runFpsRefreshHeadroomTurbo()).toThrow('Unsupported');
    expect(() => runFpsRefreshHeadroomTurbo([], { now: () => 0 })).toThrow('Unsupported');
    expect(() => runFpsRefreshHeadroomTurbo(null, options)).toThrow('samples must be an array');
    expect(() => runFpsRefreshHeadroomTurbo([], { ...options, windowSize: 0 }))
      .toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runFpsRefreshHeadroomTurbo([], { ...options, windowSize: 65 }))
      .toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runFpsRefreshHeadroomTurbo([], { ...options, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runFpsRefreshHeadroomTurbo([], { ...options, windowSize: 1, minimumSamples: 2 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runFpsRefreshHeadroomTurbo([], { ...options, minimumHeadroom: -1 }))
      .toThrow('minimumHeadroom must be non-negative');
    expect(() => runFpsRefreshHeadroomTurbo([], { ...options, persistenceThreshold: 0 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 64');
    expect(() => runFpsRefreshHeadroomTurbo([null], options)).toThrow('snapshot must be an object');
    expect(() => runFpsRefreshHeadroomTurbo([{}], options)).toThrow('requires a system-facts snapshot');
    expect(() => runFpsRefreshHeadroomTurbo([], { ...options, now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
