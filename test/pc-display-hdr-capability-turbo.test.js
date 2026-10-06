import {
  DISPLAY_HDR_CAPABILITY_TRIGGERS,
  DISPLAY_HDR_CAPABILITY_TURBO_ID,
  DISPLAY_HDR_CAPABILITY_TURBO_VERSION,
  runDisplayHdrCapabilityTurbo
} from '../pc/engines/display-pipeline/turbos/hdr-capability/turbo.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    hdr: true,
    capabilities: { displayObservation: true },
    ...overrides
  };
}

const options = { trigger: 'health.interval', now: () => 0 };

describe('display-pipeline hdr-capability turbo', () => {
  test('publishes identity and detects HDR movement', () => {
    const result = runDisplayHdrCapabilityTurbo([
      facts({ hdr: true }), facts({ hdr: false }), facts({ hdr: true })
    ], { ...options, changeThreshold: 2 });
    expect(DISPLAY_HDR_CAPABILITY_TURBO_ID).toBe('display-pipeline.hdr-capability');
    expect(DISPLAY_HDR_CAPABILITY_TURBO_VERSION).toBe(1);
    expect(DISPLAY_HDR_CAPABILITY_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(result).toMatchObject({ turbo: DISPLAY_HDR_CAPABILITY_TURBO_ID, sampleCount: 3,
      observedCount: 3, enabledCount: 2, disabledCount: 1, transitionCount: 2,
      comparisonCount: 2, latestHdr: true, state: 'hdr-drift-sustained', confidence: 1,
      recommendations: ['review-hdr-stability', 'hold-unapproved-display-policy'] });
    expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('preserves every evidence state and recommendation', () => {
    expect(runDisplayHdrCapabilityTurbo([], options)).toMatchObject({
      state: 'insufficient-data', sampleCount: 0, latestHdr: null, confidence: 0,
      recommendations: ['collect-more-hdr-samples']
    });
    expect(runDisplayHdrCapabilityTurbo([facts({ environment: 'headless' }),
      facts({ environment: 'headless' })], options)).toMatchObject({ state: 'no-display', noDisplayCount: 2 });
    expect(runDisplayHdrCapabilityTurbo([facts({ capabilities: { displayObservation: false } }),
      facts({ capabilities: { displayObservation: false } })], options)).toMatchObject({
      state: 'no-observation', noObservationCount: 2, recommendations: ['request-hdr-observation']
    });
    expect(runDisplayHdrCapabilityTurbo([facts({ hdr: null }), facts({ hdr: null })], options)).toMatchObject({
      state: 'incomplete-hdr-evidence', incompleteCount: 2, recommendations: ['request-complete-hdr-evidence']
    });
    expect(runDisplayHdrCapabilityTurbo([facts({ environment: 'other' }), facts({ environment: 'other' })], options))
      .toMatchObject({ state: 'incomplete-hdr-evidence' });
    expect(runDisplayHdrCapabilityTurbo([facts({ hdr: true }), facts({ hdr: false })],
      { ...options, changeThreshold: 2 })).toMatchObject({ state: 'hdr-drift-observed', transitionCount: 1,
      recommendations: ['observe-next-hdr-sample'] });
    expect(runDisplayHdrCapabilityTurbo([facts({ hdr: true }), facts({ hdr: true })], options))
      .toMatchObject({ state: 'hdr-enabled', recommendations: ['preserve-observed-hdr-state'] });
    expect(runDisplayHdrCapabilityTurbo([facts({ hdr: false }), facts({ hdr: false })], options))
      .toMatchObject({ state: 'hdr-disabled', recommendations: ['preserve-observed-sdr-state'] });
    expect(runDisplayHdrCapabilityTurbo([facts({ hdr: true }), facts({ hdr: false })],
      { ...options, changeThreshold: 3 })).toMatchObject({ state: 'hdr-drift-observed' });
  });

  test('applies window and default boundaries', () => {
    expect(runDisplayHdrCapabilityTurbo([facts(), facts({ capabilities: { displayObservation: false } }),
      facts({ hdr: false })], { ...options, windowSize: 2, minimumSamples: 1 }))
      .toMatchObject({ sampleCount: 2, state: 'no-observation', noObservationCount: 1 });
    expect(runDisplayHdrCapabilityTurbo(undefined, { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ sampleCount: 0, state: 'insufficient-data' });
    expect(runDisplayHdrCapabilityTurbo([facts(), facts()], { trigger: 'health.interval' }))
      .toMatchObject({ state: 'hdr-enabled', sampleCount: 2 });
  });

  test('rejects malformed inputs and unsafe bounds', () => {
    expect(() => runDisplayHdrCapabilityTurbo()).toThrow('Unsupported');
    expect(() => runDisplayHdrCapabilityTurbo([], { now: () => 0 })).toThrow('Unsupported');
    expect(() => runDisplayHdrCapabilityTurbo(null, options)).toThrow('samples must be an array');
    expect(() => runDisplayHdrCapabilityTurbo([], { ...options, windowSize: 0 })).toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runDisplayHdrCapabilityTurbo([], { ...options, windowSize: 65 })).toThrow('windowSize must be an integer from 1 to 64');
    expect(() => runDisplayHdrCapabilityTurbo([], { ...options, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runDisplayHdrCapabilityTurbo([], { ...options, windowSize: 1, minimumSamples: 2 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runDisplayHdrCapabilityTurbo([], { ...options, changeThreshold: 0 })).toThrow('changeThreshold must be an integer from 1 to 64');
    expect(() => runDisplayHdrCapabilityTurbo([null], options)).toThrow('snapshot must be an object');
    expect(() => runDisplayHdrCapabilityTurbo([{}], options)).toThrow('requires a system-facts snapshot');
    expect(() => runDisplayHdrCapabilityTurbo([], { ...options, now: () => NaN })).toThrow('clock must return a number');
  });
});
