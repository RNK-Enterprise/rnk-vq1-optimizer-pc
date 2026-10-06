import {
  FRAME_TARGET_GAP_TRIGGERS,
  FRAME_TARGET_GAP_TURBO_ID,
  runFrameTargetGapTurbo
} from '../pc/engines/frame-pacing/turbos/target-gap/turbo.js';

const trigger = 'health.interval';
const stamp = 1760000000000;
const snapshot = (fps, targetFps = 60, environment = 'interactive', capabilities) => ({
  engine: 'system-facts', environment, fps, targetFps, capabilities
});

describe('frame-pacing target-gap turbo', () => {
  test('exposes immutable identity and reports an empty bounded window', () => {
    const report = runFrameTargetGapTurbo([], { trigger, now: () => stamp });

    expect(FRAME_TARGET_GAP_TURBO_ID).toBe('frame-pacing.target-gap');
    expect(Object.isFrozen(FRAME_TARGET_GAP_TRIGGERS)).toBe(true);
    expect(report).toMatchObject({ turbo: FRAME_TARGET_GAP_TURBO_ID, sampleCount: 0,
      state: 'insufficient-data', confidence: 0, maximumGap: null });
    expect(Object.isFrozen(report)).toBe(true);
    expect(report.actions).toEqual([]);
  });

  test('classifies healthy, elevated, and critical target gaps', () => {
    const healthy = runFrameTargetGapTurbo([snapshot(60), snapshot(65)], { trigger, now: () => stamp });
    const elevatedObserved = runFrameTargetGapTurbo([snapshot(56)], {
      trigger, minimumSamples: 1, persistenceThreshold: 2, now: () => stamp
    });
    const elevatedSustained = runFrameTargetGapTurbo([snapshot(56), snapshot(55)], { trigger, now: () => stamp });
    const criticalObserved = runFrameTargetGapTurbo([snapshot(45)], {
      trigger, minimumSamples: 1, persistenceThreshold: 2, now: () => stamp
    });
    const criticalSustained = runFrameTargetGapTurbo([snapshot(45), snapshot(40)], { trigger, now: () => stamp });

    expect(healthy).toMatchObject({ state: 'healthy-target-gap', maximumGap: 0 });
    expect(elevatedObserved).toMatchObject({ state: 'elevated-gap-observed', elevatedCount: 1 });
    expect(elevatedSustained).toMatchObject({ state: 'elevated-gap-sustained', elevatedCount: 2,
      recommendations: ['review-fps-target-gap'] });
    expect(criticalObserved).toMatchObject({ state: 'critical-gap-observed', criticalCount: 1 });
    expect(criticalSustained).toMatchObject({ state: 'critical-gap-sustained', criticalCount: 2,
      maximumGap: 20, recommendations: ['review-foreground-workload', 'hold-unapproved-display-policy'] });
  });

  test('handles headless, disabled, incomplete, and saturated target evidence', () => {
    const headless = runFrameTargetGapTurbo([snapshot(40, 60, 'headless'), snapshot(40, 60, 'headless')], {
      trigger, now: () => stamp
    });
    const disabled = runFrameTargetGapTurbo([
      snapshot(40, 60, 'interactive', { displayObservation: false }),
      snapshot(40, 60, 'interactive', { displayObservation: false })
    ], { trigger, now: () => stamp });
    const incomplete = runFrameTargetGapTurbo([
      snapshot(null), snapshot(50, null)
    ], { trigger, now: () => stamp });
    const saturated = runFrameTargetGapTurbo([snapshot(0), snapshot(120), snapshot(0)], {
      trigger, minimumSamples: 2, now: () => stamp
    });

    expect(headless).toMatchObject({ state: 'no-display', noDisplayCount: 2 });
    expect(disabled).toMatchObject({ state: 'no-observation', noObservationCount: 2 });
    expect(incomplete).toMatchObject({ state: 'incomplete-target-evidence', incompleteCount: 2,
      recommendations: ['request-explicit-fps-target'] });
    expect(saturated).toMatchObject({ maximumGap: 60, confidence: 1 });
  });

  test('rejects malformed snapshots, triggers, bounds, thresholds, and clocks', () => {
    expect(() => runFrameTargetGapTurbo('bad', { trigger })).toThrow(TypeError);
    expect(() => runFrameTargetGapTurbo([null], { trigger })).toThrow(TypeError);
    expect(() => runFrameTargetGapTurbo()).toThrow('Unsupported');
    expect(() => runFrameTargetGapTurbo([{}], { trigger })).toThrow('system-facts');
    expect(() => runFrameTargetGapTurbo([], { trigger: 'unsupported' })).toThrow('Unsupported');
    expect(() => runFrameTargetGapTurbo([], { trigger, windowSize: 0 })).toThrow(RangeError);
    expect(() => runFrameTargetGapTurbo([], { trigger, windowSize: 65 })).toThrow(RangeError);
    expect(() => runFrameTargetGapTurbo([], { trigger, minimumSamples: 0 })).toThrow(RangeError);
    expect(() => runFrameTargetGapTurbo([], { trigger, minimumSamples: 3, windowSize: 2 }))
      .toThrow(RangeError);
    expect(() => runFrameTargetGapTurbo([], { trigger, criticalThreshold: -1 })).toThrow(RangeError);
    expect(() => runFrameTargetGapTurbo([], { trigger, elevatedThreshold: -1 })).toThrow(RangeError);
    expect(() => runFrameTargetGapTurbo([], { trigger, criticalThreshold: 5, elevatedThreshold: 5 }))
      .toThrow('elevatedThreshold must be below criticalThreshold');
    expect(() => runFrameTargetGapTurbo([], { trigger, persistenceThreshold: 0 })).toThrow(RangeError);
    expect(() => runFrameTargetGapTurbo([], { trigger, now: () => Number.NaN })).toThrow('clock');
  });
});
