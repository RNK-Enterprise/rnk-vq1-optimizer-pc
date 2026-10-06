import {
  FPS_OBSERVATION_CONFIDENCE_TRIGGERS,
  FPS_OBSERVATION_CONFIDENCE_TURBO_ID,
  FPS_OBSERVATION_CONFIDENCE_TURBO_VERSION,
  runFpsObservationConfidenceTurbo
} from '../pc/engines/fps-target/turbos/observation-confidence/turbo.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    refreshRateHz: 144,
    fps: 120,
    userFpsTarget: 120,
    capabilities: { displayObservation: true },
    ...overrides
  };
}

const options = { trigger: 'health.interval', now: () => 0 };

describe('fps-target observation-confidence turbo', () => {
  test('publishes identity and measures complete evidence', () => {
    const result = runFpsObservationConfidenceTurbo([facts(), facts()], options);

    expect(FPS_OBSERVATION_CONFIDENCE_TURBO_ID).toBe('fps-target.observation-confidence');
    expect(FPS_OBSERVATION_CONFIDENCE_TURBO_VERSION).toBe(1);
    expect(FPS_OBSERVATION_CONFIDENCE_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(result).toMatchObject({
      turbo: FPS_OBSERVATION_CONFIDENCE_TURBO_ID,
      sampleCount: 2,
      completeCount: 2,
      partialCount: 0,
      lowCount: 0,
      averageConfidence: 1,
      state: 'high-confidence-observation',
      confidence: 1,
      recommendations: ['no-change']
    });
    expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('preserves every evidence state and recommendation', () => {
    expect(runFpsObservationConfidenceTurbo([], options)).toMatchObject({
      state: 'insufficient-data', sampleCount: 0, averageConfidence: null, confidence: 0,
      recommendations: ['collect-more-confidence-samples']
    });
    expect(runFpsObservationConfidenceTurbo([facts({ environment: 'headless' }),
      facts({ environment: 'headless' })], options)).toMatchObject({
      state: 'no-display', noDisplayCount: 2, recommendations: ['keep-fps-controls-disabled']
    });
    expect(runFpsObservationConfidenceTurbo([facts({ capabilities: { displayObservation: false } }),
      facts({ capabilities: { displayObservation: false } })], options)).toMatchObject({
      state: 'no-observation', noObservationCount: 2,
      recommendations: ['keep-confidence-observation-disabled']
    });
    expect(runFpsObservationConfidenceTurbo([facts({ environment: 'other' }),
      facts({ environment: 'other' })], options)).toMatchObject({
      state: 'incomplete-observation', incompleteCount: 2,
      recommendations: ['request-refresh-and-fps-evidence']
    });
    expect(runFpsObservationConfidenceTurbo([facts({ refreshRateHz: null, fps: null, userFpsTarget: null }),
      facts({ refreshRateHz: null, fps: null, userFpsTarget: null })], options)).toMatchObject({
      state: 'incomplete-observation', incompleteCount: 2
    });
    expect(runFpsObservationConfidenceTurbo([facts({ userFpsTarget: null }),
      facts({ userFpsTarget: null })], options)).toMatchObject({
      state: 'partial-observation', partialCount: 2, averageConfidence: 0.8,
      recommendations: ['complete-optional-fps-evidence']
    });
    expect(runFpsObservationConfidenceTurbo([facts({ refreshRateHz: null, fps: null, userFpsTarget: 60 }),
      facts({ refreshRateHz: null, fps: null, userFpsTarget: 60 })],
      { ...options, persistenceThreshold: 3 })).toMatchObject({
      state: 'low-confidence-observed', lowCount: 2,
      recommendations: ['observe-next-confidence-sample']
    });
    expect(runFpsObservationConfidenceTurbo([facts({ refreshRateHz: null, fps: 120, userFpsTarget: null }),
      facts({ refreshRateHz: null, fps: 110, userFpsTarget: null })],
      { ...options, minimumConfidence: 0.5 })).toMatchObject({
      state: 'low-confidence-sustained', lowCount: 2,
      recommendations: ['hold-target-decision', 'request-complete-fps-evidence']
    });
  });

  test('applies window and default boundaries', () => {
    const result = runFpsObservationConfidenceTurbo([
      facts(), facts({ capabilities: { displayObservation: false } }), facts()
    ], { ...options, windowSize: 2, minimumSamples: 1 });
    expect(result).toMatchObject({ sampleCount: 2, state: 'no-observation',
      noObservationCount: 1, completeCount: 1 });
    expect(runFpsObservationConfidenceTurbo(undefined, { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ sampleCount: 0, state: 'insufficient-data' });
    expect(runFpsObservationConfidenceTurbo([facts(), facts()], { trigger: 'health.interval' }))
      .toMatchObject({ state: 'high-confidence-observation', sampleCount: 2 });
  });

  test('rejects malformed inputs and unsafe bounds', () => {
    expect(() => runFpsObservationConfidenceTurbo()).toThrow('Unsupported');
    expect(() => runFpsObservationConfidenceTurbo([], { now: () => 0 })).toThrow('Unsupported');
    expect(() => runFpsObservationConfidenceTurbo(null, options)).toThrow('samples must be an array');
    expect(() => runFpsObservationConfidenceTurbo([], { ...options, windowSize: 0 }))
      .toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runFpsObservationConfidenceTurbo([], { ...options, windowSize: 65 }))
      .toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runFpsObservationConfidenceTurbo([], { ...options, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runFpsObservationConfidenceTurbo([], { ...options, windowSize: 1, minimumSamples: 2 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runFpsObservationConfidenceTurbo([], { ...options, minimumConfidence: 0 }))
      .toThrow('minimumConfidence must be above 0 and at most 1');
    expect(() => runFpsObservationConfidenceTurbo([], { ...options, minimumConfidence: 1.1 }))
      .toThrow('minimumConfidence must be above 0 and at most 1');
    expect(() => runFpsObservationConfidenceTurbo([], { ...options, persistenceThreshold: 0 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 64');
    expect(() => runFpsObservationConfidenceTurbo([null], options)).toThrow('snapshot must be an object');
    expect(() => runFpsObservationConfidenceTurbo([{}], options)).toThrow('requires a system-facts snapshot');
    expect(() => runFpsObservationConfidenceTurbo([], { ...options, now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
