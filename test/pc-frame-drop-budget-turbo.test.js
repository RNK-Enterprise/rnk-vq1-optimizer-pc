import {
  FRAME_DROP_BUDGET_TRIGGERS,
  FRAME_DROP_BUDGET_TURBO_ID,
  runFrameDropBudgetTurbo
} from '../pc/engines/frame-pacing/turbos/drop-budget/turbo.js';

const trigger = 'health.interval';
const stamp = 1760000000000;
const snapshot = (dropped, environment = 'interactive', capabilities) => ({
  engine: 'system-facts', environment, droppedFramePercent: dropped, capabilities
});

describe('frame-pacing drop-budget turbo', () => {
  test('exposes immutable identity and reports an empty bounded window', () => {
    const report = runFrameDropBudgetTurbo([], { trigger, now: () => stamp });

    expect(FRAME_DROP_BUDGET_TURBO_ID).toBe('frame-pacing.drop-budget');
    expect(Object.isFrozen(FRAME_DROP_BUDGET_TRIGGERS)).toBe(true);
    expect(report).toMatchObject({ turbo: FRAME_DROP_BUDGET_TURBO_ID, sampleCount: 0,
      state: 'insufficient-data', confidence: 0, maximumDroppedPercent: null });
    expect(Object.isFrozen(report)).toBe(true);
    expect(report.actions).toEqual([]);
  });

  test('classifies normal, elevated, and critical drop budgets', () => {
    const normal = runFrameDropBudgetTurbo([snapshot(1), snapshot(2)], { trigger, now: () => stamp });
    const elevatedObserved = runFrameDropBudgetTurbo([snapshot(6)], {
      trigger, minimumSamples: 1, persistenceThreshold: 2, now: () => stamp
    });
    const elevatedSustained = runFrameDropBudgetTurbo([snapshot(6), snapshot(7)], { trigger, now: () => stamp });
    const criticalObserved = runFrameDropBudgetTurbo([snapshot(12)], {
      trigger, minimumSamples: 1, persistenceThreshold: 2, now: () => stamp
    });
    const criticalSustained = runFrameDropBudgetTurbo([snapshot(12), snapshot(15)], { trigger, now: () => stamp });

    expect(normal).toMatchObject({ state: 'normal-drop-budget', maximumDroppedPercent: 2 });
    expect(elevatedObserved).toMatchObject({ state: 'elevated-drop-observed', elevatedCount: 1,
      recommendations: ['observe-next-drop-sample'] });
    expect(elevatedSustained).toMatchObject({ state: 'elevated-drop-sustained', elevatedCount: 2,
      recommendations: ['review-frame-drop-budget'] });
    expect(criticalObserved).toMatchObject({ state: 'critical-drop-observed', criticalCount: 1 });
    expect(criticalSustained).toMatchObject({ state: 'critical-drop-sustained', criticalCount: 2,
      recommendations: ['protect-foreground', 'hold-unapproved-display-policy'] });
  });

  test('handles headless, disabled, incomplete, clamped, and saturated evidence', () => {
    const headless = runFrameDropBudgetTurbo([snapshot(2, 'headless'), snapshot(3, 'headless')], {
      trigger, now: () => stamp
    });
    const disabled = runFrameDropBudgetTurbo([
      snapshot(2, 'interactive', { displayObservation: false }),
      snapshot(3, 'interactive', { displayObservation: false })
    ], { trigger, now: () => stamp });
    const incomplete = runFrameDropBudgetTurbo([snapshot(null), snapshot('bad')], { trigger, now: () => stamp });
    const saturated = runFrameDropBudgetTurbo([snapshot(150), snapshot(-10), snapshot(1)], {
      trigger, minimumSamples: 2, now: () => stamp
    });

    expect(headless).toMatchObject({ state: 'no-display', noDisplayCount: 2 });
    expect(disabled).toMatchObject({ state: 'no-observation', noObservationCount: 2 });
    expect(incomplete).toMatchObject({ state: 'incomplete-drop-evidence', incompleteCount: 2,
      recommendations: ['request-complete-drop-evidence'] });
    expect(saturated).toMatchObject({ maximumDroppedPercent: 100, confidence: 1 });
  });

  test('rejects malformed snapshots, triggers, bounds, thresholds, and clocks', () => {
    expect(() => runFrameDropBudgetTurbo('bad', { trigger })).toThrow(TypeError);
    expect(() => runFrameDropBudgetTurbo([null], { trigger })).toThrow(TypeError);
    expect(() => runFrameDropBudgetTurbo()).toThrow('Unsupported');
    expect(() => runFrameDropBudgetTurbo([{}], { trigger })).toThrow('system-facts');
    expect(() => runFrameDropBudgetTurbo([], { trigger: 'unsupported' })).toThrow('Unsupported');
    expect(() => runFrameDropBudgetTurbo([], { trigger, windowSize: 0 })).toThrow(RangeError);
    expect(() => runFrameDropBudgetTurbo([], { trigger, windowSize: 65 })).toThrow(RangeError);
    expect(() => runFrameDropBudgetTurbo([], { trigger, minimumSamples: 0 })).toThrow(RangeError);
    expect(() => runFrameDropBudgetTurbo([], { trigger, minimumSamples: 3, windowSize: 2 }))
      .toThrow(RangeError);
    expect(() => runFrameDropBudgetTurbo([], { trigger, criticalThreshold: -1 })).toThrow(RangeError);
    expect(() => runFrameDropBudgetTurbo([], { trigger, elevatedThreshold: 101 })).toThrow(RangeError);
    expect(() => runFrameDropBudgetTurbo([], { trigger, criticalThreshold: 5, elevatedThreshold: 5 }))
      .toThrow('elevatedThreshold must be below criticalThreshold');
    expect(() => runFrameDropBudgetTurbo([], { trigger, persistenceThreshold: 0 })).toThrow(RangeError);
    expect(() => runFrameDropBudgetTurbo([], { trigger, now: () => Number.NaN })).toThrow('clock');
  });
});
