import {
  FPS_TARGET_LIBRARY_ID,
  FPS_TARGET_LIBRARY_VERSION,
  buildFpsTargetEnvelope,
  classifyFpsTarget,
  compareFpsTarget,
  createFpsTargetLibrary
} from '../pc/engines/fps-target/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    refreshRateHz: 144,
    fps: 120,
    userFpsTarget: undefined,
    ...overrides
  };
}

describe('FPS-target library', () => {
  test('classifies user, display, observation, and unavailable targets', () => {
    expect(classifyFpsTarget(facts())).toMatchObject({
      library: FPS_TARGET_LIBRARY_ID,
      libraryVersion: FPS_TARGET_LIBRARY_VERSION,
      refreshRateHz: 144, observedFps: 120, candidateFpsTarget: 144,
      targetSource: 'display', targetGap: 24, observationEnabled: true,
      recommendations: ['hold-target-below-observed-capability']
    });
    expect(classifyFpsTarget(facts({ fps: 144 })).recommendations).toEqual(['no-change']);
    expect(classifyFpsTarget(facts({ userFpsTarget: 240 }))).toMatchObject({
      candidateFpsTarget: 144, targetSource: 'user', recommendations: ['preserve-user-fps-target']
    });
    expect(classifyFpsTarget(facts({ refreshRateHz: undefined, userFpsTarget: 100 })))
      .toMatchObject({ candidateFpsTarget: 100, targetSource: 'user' });
    expect(classifyFpsTarget(facts({ refreshRateHz: undefined, userFpsTarget: undefined })))
      .toMatchObject({ candidateFpsTarget: 120, targetSource: 'observation' });
    expect(classifyFpsTarget(facts({ refreshRateHz: undefined, fps: undefined,
      userFpsTarget: undefined }))).toMatchObject({ candidateFpsTarget: null,
      targetSource: 'unavailable', targetGap: null,
      recommendations: ['request-refresh-or-fps-observation'] });
  });

  test('preserves headless, disabled, and capability-gap states', () => {
    expect(classifyFpsTarget(facts({ environment: 'headless' })).recommendations)
      .toEqual(['keep-fps-controls-disabled']);
    expect(classifyFpsTarget(facts({ capabilities: { displayObservation: false } }))
      .recommendations).toEqual(['keep-fps-observation-disabled']);
    expect(classifyFpsTarget(facts({ refreshRateHz: 60, fps: 30 }))
      .recommendations).toEqual(['hold-target-below-observed-capability']);
    expect(classifyFpsTarget(facts({ refreshRateHz: 60, fps: undefined }))
      .recommendations).toEqual(['observe-before-applying-target']);
    expect(classifyFpsTarget(facts({ environment: 'other', refreshRateHz: undefined,
      fps: undefined })).recommendations).toEqual(['request-environment-profile']);
    expect(classifyFpsTarget(facts({ capabilities: { displayObservation: true } }))
      .observationEnabled).toBe(true);
  });

  test('compares target snapshots and builds immutable local facades', () => {
    expect(compareFpsTarget(facts(), facts({ userFpsTarget: 100 })))
      .toMatchObject({ changed: true, targetChanged: true, sourceChanged: true, observedChanged: false });
    expect(compareFpsTarget(facts(), facts({ userFpsTarget: 144 })))
      .toMatchObject({ changed: true, targetChanged: false, sourceChanged: true, observedChanged: false });
    expect(compareFpsTarget(facts(), facts({ fps: 121 })))
      .toMatchObject({ changed: true, targetChanged: false, sourceChanged: false, observedChanged: true });
    expect(compareFpsTarget(facts(), facts())).toMatchObject({ changed: false, targetGapChanged: false });
    const envelope = buildFpsTargetEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createFpsTargetLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyFpsTarget(null)).toThrow('facts must be an object');
    expect(() => classifyFpsTarget({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => buildFpsTargetEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildFpsTargetEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createFpsTargetLibrary(null)).toThrow('options must be an object');
    expect(() => createFpsTargetLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
