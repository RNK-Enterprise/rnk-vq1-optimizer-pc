import {
  CPU_SCHEDULER_GOVERNOR_TRIGGERS,
  CPU_SCHEDULER_GOVERNOR_TURBO_ID,
  CPU_SCHEDULER_GOVERNOR_TURBO_VERSION,
  runCpuSchedulerGovernorTransitionsTurbo
} from '../pc/engines/cpu-scheduler/turbos/governor-transitions/turbo.js';

function snapshot(governor, utilizationPercent, overrides = {}) {
  return {
    engine: 'system-facts',
    cpu: { governor, utilizationPercent },
    ...overrides
  };
}

describe('CPU-scheduler governor-transitions turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(CPU_SCHEDULER_GOVERNOR_TURBO_ID).toBe('cpu-scheduler.governor-transitions');
    expect(CPU_SCHEDULER_GOVERNOR_TURBO_VERSION).toBe(1);
    expect(CPU_SCHEDULER_GOVERNOR_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_SCHEDULER_GOVERNOR_TRIGGERS)).toBe(true);
  });

  test('classifies stable, powersave-under-load, frequent, and transition-watch states', () => {
    const stable = runCpuSchedulerGovernorTransitionsTurbo([
      snapshot('schedutil', 20), snapshot('schedutil', 30), snapshot('schedutil', 40), snapshot('schedutil', 50)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(stable).toMatchObject({ sampleCount: 4, observedCount: 4, unknownGovernorCount: 0,
      transitionCount: 0, transitionRate: 0, performanceCount: 0, powersaveCount: 0,
      schedutilCount: 4, powersaveUnderLoad: 0, state: 'stable-governor', confidence: 1,
      recommendations: ['no-change'], actions: [] });

    const powersave = runCpuSchedulerGovernorTransitionsTurbo([
      snapshot('powersave', 80), snapshot('powersave', 90), snapshot('powersave', 70), snapshot('schedutil', 70)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(powersave).toMatchObject({ powersaveUnderLoad: 3, state: 'powersave-under-load',
      recommendations: ['review-documented-governor-control'] });

    const frequent = runCpuSchedulerGovernorTransitionsTurbo([
      snapshot('performance', 20), snapshot('powersave', 20), snapshot('schedutil', 20), snapshot('performance', 20)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(frequent).toMatchObject({ transitionCount: 3, transitionRate: 1,
      state: 'frequent-transition', recommendations: ['observe-governor-transition-duration'] });

    const watch = runCpuSchedulerGovernorTransitionsTurbo([
      snapshot('performance', 20), snapshot('powersave', 20), snapshot('powersave', 20), snapshot('powersave', 20)
    ], { trigger: 'health.interval', transitionThreshold: 3, transitionRateThreshold: 0.3, now: () => 0 });
    expect(watch).toMatchObject({ transitionCount: 1, transitionRate: 0.3333,
      state: 'transition-watch', recommendations: ['observe-next-governor-sample'] });
    expect(Object.isFrozen(stable)).toBe(true);
    expect(Object.isFrozen(stable.actions)).toBe(true);
  });

  test('bounds windows and preserves sparse, empty, and unknown evidence', () => {
    const empty = runCpuSchedulerGovernorTransitionsTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-governor-samples'] });

    const bounded = runCpuSchedulerGovernorTransitionsTurbo([
      snapshot('performance', 20), snapshot('powersave', 20), snapshot('schedutil', 20),
      snapshot('performance', 20), snapshot('powersave', 20)
    ], { trigger: 'health.interval', windowSize: 3, minimumSamples: 3, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 3, observedCount: 3, transitionCount: 2 });

    const insufficient = runCpuSchedulerGovernorTransitionsTurbo([snapshot('schedutil', 20)], {
      trigger: 'health.interval', minimumSamples: 2, now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const unknown = runCpuSchedulerGovernorTransitionsTurbo([
      snapshot('bad', 20), snapshot(null, null)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownGovernorCount: 2,
      transitionCount: 0, state: 'no-observation', confidence: 0,
      recommendations: ['request-governor-observation'] });

    const normalized = runCpuSchedulerGovernorTransitionsTurbo([
      snapshot(' PERFORMANCE ', 120), snapshot('powersave', -1), snapshot('schedutil', 20)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(normalized).toMatchObject({ observedCount: 3, performanceCount: 1,
      powersaveCount: 1, schedutilCount: 1, powersaveUnderLoad: 0 });
  });

  test('rejects malformed inputs, limits, thresholds, snapshots, and clocks', () => {
    expect(() => runCpuSchedulerGovernorTransitionsTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuSchedulerGovernorTransitionsTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-scheduler governor-transitions trigger: bad');
    expect(() => runCpuSchedulerGovernorTransitionsTurbo())
      .toThrow('Unsupported CPU-scheduler governor-transitions trigger: unknown');
    expect(() => runCpuSchedulerGovernorTransitionsTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuSchedulerGovernorTransitionsTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuSchedulerGovernorTransitionsTurbo([], {
      trigger: 'health.interval', transitionThreshold: 65
    })).toThrow('transitionThreshold must be an integer from 1 to 64');
    expect(() => runCpuSchedulerGovernorTransitionsTurbo([], {
      trigger: 'health.interval', transitionRateThreshold: 1.1
    })).toThrow('transitionRateThreshold must be between 0 and 1');
    expect(() => runCpuSchedulerGovernorTransitionsTurbo([], {
      trigger: 'health.interval', loadThreshold: 101
    })).toThrow('loadThreshold must be between 0 and 100');
    expect(() => runCpuSchedulerGovernorTransitionsTurbo([], {
      trigger: 'health.interval', loadCountThreshold: 65
    })).toThrow('loadCountThreshold must be an integer from 1 to 64');
    expect(() => runCpuSchedulerGovernorTransitionsTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuSchedulerGovernorTransitionsTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runCpuSchedulerGovernorTransitionsTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuSchedulerGovernorTransitionsTurbo([
      snapshot('schedutil', 1, { cpu: null }), snapshot('schedutil', 1)
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
