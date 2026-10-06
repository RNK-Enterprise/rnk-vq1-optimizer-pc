import {
  FRAME_CADENCE_STABILITY_TRIGGERS,
  FRAME_CADENCE_STABILITY_TURBO_ID,
  runFrameCadenceStabilityTurbo
} from '../pc/engines/frame-pacing/turbos/cadence-stability/turbo.js';

const trigger = 'health.interval';
const stamp = 1760000000000;
const snapshot = (frameTime, environment = 'interactive', capabilities) => ({
  engine: 'system-facts', environment, frameTimeMs: frameTime, capabilities
});

describe('frame-pacing cadence-stability turbo', () => {
  test('exposes immutable identity and reports an empty bounded window', () => {
    const report = runFrameCadenceStabilityTurbo([], { trigger, now: () => stamp });

    expect(FRAME_CADENCE_STABILITY_TURBO_ID).toBe('frame-pacing.cadence-stability');
    expect(Object.isFrozen(FRAME_CADENCE_STABILITY_TRIGGERS)).toBe(true);
    expect(report).toMatchObject({ turbo: FRAME_CADENCE_STABILITY_TURBO_ID, sampleCount: 0,
      state: 'insufficient-data', confidence: 0, maximumDelta: 0 });
    expect(Object.isFrozen(report)).toBe(true);
    expect(report.actions).toEqual([]);
  });

  test('classifies stable, observed, and sustained cadence movement', () => {
    const stable = runFrameCadenceStabilityTurbo([snapshot(16), snapshot(16)], { trigger, now: () => stamp });
    const observed = runFrameCadenceStabilityTurbo([snapshot(16), snapshot(20)], {
      trigger, persistenceThreshold: 2, now: () => stamp
    });
    const sustained = runFrameCadenceStabilityTurbo([snapshot(16), snapshot(22), snapshot(16)], {
      trigger, now: () => stamp
    });

    expect(stable).toMatchObject({ state: 'stable-cadence', driftCount: 0, maximumDelta: 0 });
    expect(observed).toMatchObject({ state: 'cadence-drift-observed', driftCount: 1,
      maximumDelta: 4, recommendations: ['observe-next-cadence-sample'] });
    expect(sustained).toMatchObject({ state: 'sustained-cadence-drift', driftCount: 2,
      maximumDelta: 6, recommendations: ['review-frame-cadence', 'hold-unapproved-display-policy'] });
  });

  test('handles headless, disabled, incomplete, and saturated cadence evidence', () => {
    const headless = runFrameCadenceStabilityTurbo([snapshot(16, 'headless'), snapshot(17, 'headless')], {
      trigger, now: () => stamp
    });
    const disabled = runFrameCadenceStabilityTurbo([
      snapshot(16, 'interactive', { displayObservation: false }),
      snapshot(17, 'interactive', { displayObservation: false })
    ], { trigger, now: () => stamp });
    const incomplete = runFrameCadenceStabilityTurbo([snapshot(null), snapshot(0)], { trigger, now: () => stamp });
    const saturated = runFrameCadenceStabilityTurbo([snapshot(16), snapshot(16), snapshot(16)], {
      trigger, minimumSamples: 2, now: () => stamp
    });

    expect(headless).toMatchObject({ state: 'no-display', noDisplayCount: 2 });
    expect(disabled).toMatchObject({ state: 'no-observation', noObservationCount: 2 });
    expect(incomplete).toMatchObject({ state: 'incomplete-cadence-evidence', incompleteCount: 2,
      recommendations: ['request-complete-cadence-evidence'] });
    expect(saturated.confidence).toBe(1);
  });

  test('rejects malformed snapshots, triggers, bounds, thresholds, and clocks', () => {
    expect(() => runFrameCadenceStabilityTurbo('bad', { trigger })).toThrow(TypeError);
    expect(() => runFrameCadenceStabilityTurbo([null], { trigger })).toThrow(TypeError);
    expect(() => runFrameCadenceStabilityTurbo()).toThrow('Unsupported');
    expect(() => runFrameCadenceStabilityTurbo([{}], { trigger })).toThrow('system-facts');
    expect(() => runFrameCadenceStabilityTurbo([], { trigger: 'unsupported' })).toThrow('Unsupported');
    expect(() => runFrameCadenceStabilityTurbo([], { trigger, windowSize: 1 })).toThrow(RangeError);
    expect(() => runFrameCadenceStabilityTurbo([], { trigger, windowSize: 65 })).toThrow(RangeError);
    expect(() => runFrameCadenceStabilityTurbo([], { trigger, minimumSamples: 0 })).toThrow(RangeError);
    expect(() => runFrameCadenceStabilityTurbo([], { trigger, minimumSamples: 3, windowSize: 2 }))
      .toThrow(RangeError);
    expect(() => runFrameCadenceStabilityTurbo([], { trigger, deltaThreshold: -1 })).toThrow(RangeError);
    expect(() => runFrameCadenceStabilityTurbo([], { trigger, persistenceThreshold: 0 })).toThrow(RangeError);
    expect(() => runFrameCadenceStabilityTurbo([], { trigger, now: () => Number.NaN })).toThrow('clock');
  });
});
