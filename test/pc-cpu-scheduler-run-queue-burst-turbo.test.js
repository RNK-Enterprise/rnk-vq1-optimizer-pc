import {
  CPU_SCHEDULER_QUEUE_TRIGGERS,
  CPU_SCHEDULER_QUEUE_TURBO_ID,
  CPU_SCHEDULER_QUEUE_TURBO_VERSION,
  runCpuSchedulerRunQueueBurstTurbo
} from '../pc/engines/cpu-scheduler/turbos/run-queue-burst/turbo.js';

function snapshot(runQueueLength, contextSwitchesPerSecond = 0, logicalCpus = 4, overrides = {}) {
  return {
    engine: 'system-facts',
    cpu: { runQueueLength, contextSwitchesPerSecond, logicalCpus },
    ...overrides
  };
}

describe('CPU-scheduler run-queue-burst turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(CPU_SCHEDULER_QUEUE_TURBO_ID).toBe('cpu-scheduler.run-queue-burst');
    expect(CPU_SCHEDULER_QUEUE_TURBO_VERSION).toBe(1);
    expect(CPU_SCHEDULER_QUEUE_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_SCHEDULER_QUEUE_TRIGGERS)).toBe(true);
  });

  test('classifies stable, burst, sustained, and rising pressure', () => {
    const stable = runCpuSchedulerRunQueueBurstTurbo([
      snapshot(1), snapshot(2), snapshot(1), snapshot(2)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(stable).toMatchObject({ sampleCount: 4, observedCount: 4, burstCount: 0,
      burstRate: 0, peakPressure: 0.5, meanPressure: 0.375, maximumRise: 0.25,
      longestHighRun: 0, state: 'stable-window', confidence: 1,
      recommendations: ['no-change'], actions: [] });

    const burst = runCpuSchedulerRunQueueBurstTurbo([
      snapshot(4), snapshot(8), snapshot(1), snapshot(8)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(burst).toMatchObject({ burstCount: 3, burstRate: 0.75,
      peakPressure: 2, state: 'burst-detected',
      recommendations: ['observe-run-queue-duration'] });

    const sustained = runCpuSchedulerRunQueueBurstTurbo([
      snapshot(8), snapshot(12), snapshot(16), snapshot(1)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(sustained).toMatchObject({ longestHighRun: 3, state: 'sustained-pressure',
      recommendations: ['protect-scheduler-headroom'] });

    const rising = runCpuSchedulerRunQueueBurstTurbo([
      snapshot(0), snapshot(2), snapshot(4), snapshot(4)
    ], { trigger: 'health.interval', pressureThreshold: 2, burstRateThreshold: 1, now: () => 0 });
    expect(rising).toMatchObject({ burstCount: 0, maximumRise: 0.5,
      state: 'rising-pressure', recommendations: ['observe-next-scheduler-sample'] });
    expect(Object.isFrozen(stable)).toBe(true);
    expect(Object.isFrozen(stable.actions)).toBe(true);
  });

  test('bounds windows and preserves sparse, empty, and unknown evidence', () => {
    const empty = runCpuSchedulerRunQueueBurstTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-scheduler-samples'] });

    const bounded = runCpuSchedulerRunQueueBurstTurbo([
      snapshot(1), snapshot(2), snapshot(3), snapshot(4), snapshot(5)
    ], { trigger: 'health.interval', windowSize: 3, minimumSamples: 3, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 3, peakPressure: 1.25 });

    const insufficient = runCpuSchedulerRunQueueBurstTurbo([snapshot(2)], {
      trigger: 'health.interval', minimumSamples: 2, now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const unknown = runCpuSchedulerRunQueueBurstTurbo([
      snapshot(null, null), snapshot('bad', 'bad')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, burstCount: 0,
      peakPressure: null, meanPressure: null, state: 'no-observation', confidence: 0,
      recommendations: ['request-scheduler-observation'] });

    const sparse = runCpuSchedulerRunQueueBurstTurbo([
      snapshot(null, 120000), snapshot(8, null, null), snapshot(0, 0, 0)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(sparse).toMatchObject({ observedCount: 3, peakPressure: 1.2, burstRate: 0.6667 });
  });

  test('rejects malformed inputs, limits, thresholds, snapshots, and clocks', () => {
    expect(() => runCpuSchedulerRunQueueBurstTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuSchedulerRunQueueBurstTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-scheduler run-queue-burst trigger: bad');
    expect(() => runCpuSchedulerRunQueueBurstTurbo())
      .toThrow('Unsupported CPU-scheduler run-queue-burst trigger: unknown');
    expect(() => runCpuSchedulerRunQueueBurstTurbo([], {}))
      .toThrow('Unsupported CPU-scheduler run-queue-burst trigger: unknown');
    expect(() => runCpuSchedulerRunQueueBurstTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuSchedulerRunQueueBurstTurbo([], {
      trigger: 'health.interval', windowSize: 65
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuSchedulerRunQueueBurstTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuSchedulerRunQueueBurstTurbo([], {
      trigger: 'health.interval', pressureThreshold: 17
    })).toThrow('pressureThreshold must be between 0 and 16');
    expect(() => runCpuSchedulerRunQueueBurstTurbo([], {
      trigger: 'health.interval', burstRateThreshold: 1.1
    })).toThrow('burstRateThreshold must be between 0 and 1');
    expect(() => runCpuSchedulerRunQueueBurstTurbo([], {
      trigger: 'health.interval', sustainedRunLength: 1
    })).toThrow('sustainedRunLength must be an integer from 2 to 64');
    expect(() => runCpuSchedulerRunQueueBurstTurbo([], {
      trigger: 'health.interval', riseThreshold: 17
    })).toThrow('riseThreshold must be between 0 and 16');
    expect(() => runCpuSchedulerRunQueueBurstTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuSchedulerRunQueueBurstTurbo([null, null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runCpuSchedulerRunQueueBurstTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuSchedulerRunQueueBurstTurbo([
      snapshot(1, 1, 4, { cpu: null }), snapshot(1)
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
