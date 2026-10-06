import {
  FRAME_JITTER_DRIFT_TRIGGERS,
  FRAME_JITTER_DRIFT_TURBO_ID,
  runFrameJitterDriftTurbo
} from '../pc/engines/frame-pacing/turbos/jitter-drift/turbo.js';

const trigger = 'health.interval';
const stamp = 1760000000000;
const snapshot = (variance, environment = 'interactive', capabilities) => ({
  engine: 'system-facts', environment, frameTimeVarianceMs: variance, capabilities
});

describe('frame-pacing jitter-drift turbo', () => {
  test('exposes immutable identity and reports an empty bounded window', () => {
    const report = runFrameJitterDriftTurbo([], { trigger, now: () => stamp });

    expect(FRAME_JITTER_DRIFT_TURBO_ID).toBe('frame-pacing.jitter-drift');
    expect(Object.isFrozen(FRAME_JITTER_DRIFT_TRIGGERS)).toBe(true);
    expect(report).toMatchObject({
      turbo: FRAME_JITTER_DRIFT_TURBO_ID,
      trigger,
      sampleCount: 0,
      state: 'insufficient-data',
      confidence: 0,
      maximumDelta: 0
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(report.actions).toEqual([]);
  });

  test('classifies stable, observed, and sustained jitter movement', () => {
    const stable = runFrameJitterDriftTurbo([
      snapshot(3), snapshot(3)
    ], { trigger, now: () => stamp });
    const observed = runFrameJitterDriftTurbo([
      snapshot(2), snapshot(6)
    ], { trigger, changeThreshold: 2, now: () => stamp });
    const sustained = runFrameJitterDriftTurbo([
      snapshot(2), snapshot(8), snapshot(2)
    ], { trigger, now: () => stamp });

    expect(stable).toMatchObject({ state: 'stable-jitter', deltaCount: 0, maximumDelta: 0 });
    expect(observed).toMatchObject({ state: 'jitter-drift-observed', deltaCount: 1, maximumDelta: 4,
      recommendations: ['observe-next-jitter-sample'] });
    expect(sustained).toMatchObject({ state: 'sustained-jitter-drift', deltaCount: 2,
      maximumDelta: 6, recommendations: ['review-frame-jitter', 'hold-unapproved-display-policy'] });
  });

  test('handles headless, disabled, incomplete, and bounded confidence evidence', () => {
    const headless = runFrameJitterDriftTurbo([
      snapshot(2, 'headless'), snapshot(3, 'headless')
    ], { trigger, now: () => stamp });
    const disabled = runFrameJitterDriftTurbo([
      snapshot(2, 'interactive', { displayObservation: false }),
      snapshot(3, 'interactive', { displayObservation: false })
    ], { trigger, now: () => stamp });
    const incomplete = runFrameJitterDriftTurbo([
      snapshot(null), snapshot(-1)
    ], { trigger, now: () => stamp });
    const saturated = runFrameJitterDriftTurbo([
      snapshot(1), snapshot(1), snapshot(1)
    ], { trigger, minimumSamples: 2, now: () => stamp });

    expect(headless).toMatchObject({ state: 'no-display', noDisplayCount: 2,
      recommendations: ['keep-display-controls-disabled'] });
    expect(disabled).toMatchObject({ state: 'no-observation', noObservationCount: 2 });
    expect(incomplete).toMatchObject({ state: 'incomplete-jitter-evidence', incompleteCount: 2,
      recommendations: ['request-complete-jitter-evidence'] });
    expect(saturated.confidence).toBe(1);
  });

  test('rejects malformed snapshots, triggers, bounds, thresholds, and clocks', () => {
    expect(() => runFrameJitterDriftTurbo('bad', { trigger })).toThrow(TypeError);
    expect(() => runFrameJitterDriftTurbo([null], { trigger })).toThrow(TypeError);
    expect(() => runFrameJitterDriftTurbo()).toThrow('Unsupported');
    expect(() => runFrameJitterDriftTurbo([{}], { trigger })).toThrow('system-facts');
    expect(() => runFrameJitterDriftTurbo([], { trigger: 'unsupported' })).toThrow('Unsupported');
    expect(() => runFrameJitterDriftTurbo([], { trigger, windowSize: 1 })).toThrow(RangeError);
    expect(() => runFrameJitterDriftTurbo([], { trigger, windowSize: 65 })).toThrow(RangeError);
    expect(() => runFrameJitterDriftTurbo([], { trigger, minimumSamples: 0 })).toThrow(RangeError);
    expect(() => runFrameJitterDriftTurbo([], { trigger, minimumSamples: 3, windowSize: 2 }))
      .toThrow(RangeError);
    expect(() => runFrameJitterDriftTurbo([], { trigger, deltaThreshold: -1 })).toThrow(RangeError);
    expect(() => runFrameJitterDriftTurbo([], { trigger, changeThreshold: 0 })).toThrow(RangeError);
    expect(() => runFrameJitterDriftTurbo([], { trigger, changeThreshold: 65 })).toThrow(RangeError);
    expect(() => runFrameJitterDriftTurbo([], { trigger, now: () => Number.NaN }))
      .toThrow('clock');
  });
});
