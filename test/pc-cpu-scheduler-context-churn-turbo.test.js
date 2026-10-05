import {
  CPU_SCHEDULER_CHURN_TRIGGERS,
  CPU_SCHEDULER_CHURN_TURBO_ID,
  CPU_SCHEDULER_CHURN_TURBO_VERSION,
  runCpuSchedulerContextChurnTurbo
} from '../pc/engines/cpu-scheduler/turbos/context-churn/turbo.js';

function snapshot(contextSwitchesPerSecond, overrides = {}) {
  return {
    engine: 'system-facts',
    cpu: { contextSwitchesPerSecond },
    ...overrides
  };
}

describe('CPU-scheduler context-churn turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(CPU_SCHEDULER_CHURN_TURBO_ID).toBe('cpu-scheduler.context-churn');
    expect(CPU_SCHEDULER_CHURN_TURBO_VERSION).toBe(1);
    expect(CPU_SCHEDULER_CHURN_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_SCHEDULER_CHURN_TRIGGERS)).toBe(true);
  });

  test('classifies stable, high, volatile, and reversal churn', () => {
    const stable = runCpuSchedulerContextChurnTurbo([
      snapshot(10000), snapshot(20000), snapshot(20000), snapshot(30000)
    ], { trigger: 'health.interval', rateThreshold: 1, now: () => 0 });
    expect(stable).toMatchObject({ sampleCount: 4, observedCount: 4, highRateCount: 0,
      highRateFraction: 0, peakSwitchRate: 0.3, meanSwitchRate: 0.2,
      maximumDelta: 0.1, reversalCount: 0, state: 'stable-churn', confidence: 1,
      recommendations: ['no-change'], actions: [] });

    const high = runCpuSchedulerContextChurnTurbo([
      snapshot(120000), snapshot(150000), snapshot(50000), snapshot(160000)
    ], { trigger: 'workload.changed', volatilityThreshold: 2, now: () => 0 });
    expect(high).toMatchObject({ highRateCount: 3, highRateFraction: 0.75,
      state: 'high-churn', recommendations: ['observe-scheduler-churn-duration'] });

    const volatile = runCpuSchedulerContextChurnTurbo([
      snapshot(0), snapshot(120000), snapshot(0), snapshot(120000)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(volatile).toMatchObject({ maximumDelta: 1.2, state: 'volatile-churn',
      recommendations: ['observe-context-switch-volatility'] });

    const reversal = runCpuSchedulerContextChurnTurbo([
      snapshot(40000), snapshot(60000), snapshot(50000), snapshot(70000)
    ], { trigger: 'health.interval', volatilityThreshold: 16, now: () => 0 });
    expect(reversal).toMatchObject({ reversalCount: 2, state: 'reversal-watch',
      recommendations: ['observe-next-churn-sample'] });
    expect(Object.isFrozen(stable)).toBe(true);
    expect(Object.isFrozen(stable.actions)).toBe(true);
  });

  test('bounds windows and preserves sparse, empty, and unknown evidence', () => {
    const empty = runCpuSchedulerContextChurnTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-context-switch-samples'] });

    const bounded = runCpuSchedulerContextChurnTurbo([
      snapshot(10000), snapshot(20000), snapshot(30000), snapshot(40000), snapshot(50000)
    ], { trigger: 'health.interval', windowSize: 3, minimumSamples: 3, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 3, peakSwitchRate: 0.5 });

    const insufficient = runCpuSchedulerContextChurnTurbo([snapshot(20000)], {
      trigger: 'health.interval', minimumSamples: 2, now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const unknown = runCpuSchedulerContextChurnTurbo([
      snapshot(null), snapshot('bad')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, highRateCount: 0,
      peakSwitchRate: null, meanSwitchRate: null, state: 'no-observation', confidence: 0,
      recommendations: ['request-context-switch-observation'] });

    const capped = runCpuSchedulerContextChurnTurbo([
      snapshot(2000000), snapshot(-1), snapshot(100000)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(capped).toMatchObject({ observedCount: 2, peakSwitchRate: 16, highRateFraction: 0.6667 });
  });

  test('rejects malformed inputs, limits, thresholds, snapshots, and clocks', () => {
    expect(() => runCpuSchedulerContextChurnTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuSchedulerContextChurnTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-scheduler context-churn trigger: bad');
    expect(() => runCpuSchedulerContextChurnTurbo())
      .toThrow('Unsupported CPU-scheduler context-churn trigger: unknown');
    expect(() => runCpuSchedulerContextChurnTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuSchedulerContextChurnTurbo([], {
      trigger: 'health.interval', windowSize: 65
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuSchedulerContextChurnTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuSchedulerContextChurnTurbo([], {
      trigger: 'health.interval', rateThreshold: 17
    })).toThrow('rateThreshold must be between 0 and 16');
    expect(() => runCpuSchedulerContextChurnTurbo([], {
      trigger: 'health.interval', volatilityThreshold: 17
    })).toThrow('volatilityThreshold must be between 0 and 16');
    expect(() => runCpuSchedulerContextChurnTurbo([], {
      trigger: 'health.interval', reversalThreshold: 65
    })).toThrow('reversalThreshold must be an integer from 1 to 64');
    expect(() => runCpuSchedulerContextChurnTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuSchedulerContextChurnTurbo([null, null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runCpuSchedulerContextChurnTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuSchedulerContextChurnTurbo([
      snapshot(1, { cpu: null }), snapshot(1)
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
