import {
  CPU_SCHEDULER_MISMATCH_TRIGGERS,
  CPU_SCHEDULER_MISMATCH_TURBO_ID,
  CPU_SCHEDULER_MISMATCH_TURBO_VERSION,
  runCpuSchedulerQueueUtilizationMismatchTurbo
} from '../pc/engines/cpu-scheduler/turbos/queue-utilization-mismatch/turbo.js';

function snapshot(runQueueLength, utilizationPercent, logicalCpus = 4, overrides = {}) {
  return {
    engine: 'system-facts',
    cpu: { runQueueLength, utilizationPercent, logicalCpus },
    ...overrides
  };
}

describe('CPU-scheduler queue-utilization-mismatch turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(CPU_SCHEDULER_MISMATCH_TURBO_ID).toBe('cpu-scheduler.queue-utilization-mismatch');
    expect(CPU_SCHEDULER_MISMATCH_TURBO_VERSION).toBe(1);
    expect(CPU_SCHEDULER_MISMATCH_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_SCHEDULER_MISMATCH_TRIGGERS)).toBe(true);
  });

  test('classifies aligned, queue-low-utilization, busy-low-queue, burst, and rising states', () => {
    const aligned = runCpuSchedulerQueueUtilizationMismatchTurbo([
      snapshot(2, 12.5), snapshot(2, 12.5), snapshot(2, 12.5), snapshot(2, 12.5)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(aligned).toMatchObject({ sampleCount: 4, observedCount: 4,
      mismatchRate: 0, queuedLowUtilizationCount: 0, busyLowQueueCount: 0,
      peakMismatch: 0, meanMismatch: 0, maximumRise: 0,
      state: 'aligned-window', confidence: 1, recommendations: ['no-change'], actions: [] });

    const queued = runCpuSchedulerQueueUtilizationMismatchTurbo([
      snapshot(8, 20), snapshot(12, 30), snapshot(8, 40), snapshot(1, 60)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(queued).toMatchObject({ queuedLowUtilizationCount: 3,
      state: 'queued-low-utilization', recommendations: ['review-queue-or-idle-accounting'] });

    const busy = runCpuSchedulerQueueUtilizationMismatchTurbo([
      snapshot(0, 90), snapshot(1, 85), snapshot(0, 80), snapshot(8, 50)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(busy).toMatchObject({ busyLowQueueCount: 3,
      state: 'busy-low-queue', recommendations: ['review-utilization-or-queue-accounting'] });

    const burst = runCpuSchedulerQueueUtilizationMismatchTurbo([
      snapshot(8, 20), snapshot(0, 90), snapshot(8, 20), snapshot(0, 90)
    ], { trigger: 'health.interval', patternCount: 5, now: () => 0 });
    expect(burst).toMatchObject({ mismatchRate: 0.6, state: 'mismatch-burst',
      recommendations: ['observe-queue-utilization-alignment'] });

    const rising = runCpuSchedulerQueueUtilizationMismatchTurbo([
      snapshot(null, null), snapshot(0, 50), snapshot(4, 100), snapshot(8, 50)
    ], { trigger: 'health.interval', mismatchRateThreshold: 1, patternCount: 5, now: () => 0 });
    expect(rising).toMatchObject({ maximumRise: 0.25, state: 'rising-mismatch',
      recommendations: ['observe-next-queue-utilization-sample'] });
    expect(Object.isFrozen(aligned)).toBe(true);
    expect(Object.isFrozen(aligned.actions)).toBe(true);
  });

  test('bounds windows and preserves sparse, empty, and unknown evidence', () => {
    const empty = runCpuSchedulerQueueUtilizationMismatchTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-scheduler-samples'] });

    const bounded = runCpuSchedulerQueueUtilizationMismatchTurbo([
      snapshot(0, 50), snapshot(4, 50), snapshot(8, 50), snapshot(12, 50), snapshot(16, 50)
    ], { trigger: 'health.interval', windowSize: 3, minimumSamples: 3, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 3, peakMismatch: 0.5 });

    const insufficient = runCpuSchedulerQueueUtilizationMismatchTurbo([snapshot(2, 50)], {
      trigger: 'health.interval', minimumSamples: 2, now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const unknown = runCpuSchedulerQueueUtilizationMismatchTurbo([
      snapshot(null, null), snapshot('bad', 'bad')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, mismatchRate: 0,
      peakMismatch: null, meanMismatch: null, state: 'no-observation', confidence: 0,
      recommendations: ['request-queue-utilization-observation'] });

    const fallback = runCpuSchedulerQueueUtilizationMismatchTurbo([
      snapshot(8, 50, null), snapshot(0, 120, 0), snapshot(0, -10, 4)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(fallback).toMatchObject({ observedCount: 3, peakMismatch: 1 });
  });

  test('rejects malformed inputs, limits, thresholds, snapshots, and clocks', () => {
    expect(() => runCpuSchedulerQueueUtilizationMismatchTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuSchedulerQueueUtilizationMismatchTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-scheduler queue-utilization-mismatch trigger: bad');
    expect(() => runCpuSchedulerQueueUtilizationMismatchTurbo())
      .toThrow('Unsupported CPU-scheduler queue-utilization-mismatch trigger: unknown');
    expect(() => runCpuSchedulerQueueUtilizationMismatchTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuSchedulerQueueUtilizationMismatchTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuSchedulerQueueUtilizationMismatchTurbo([], {
      trigger: 'health.interval', mismatchRateThreshold: 1.1
    })).toThrow('mismatchRateThreshold must be between 0 and 1');
    expect(() => runCpuSchedulerQueueUtilizationMismatchTurbo([], {
      trigger: 'health.interval', riseThreshold: 1.1
    })).toThrow('riseThreshold must be between 0 and 1');
    expect(() => runCpuSchedulerQueueUtilizationMismatchTurbo([], {
      trigger: 'health.interval', patternCount: 65
    })).toThrow('patternCount must be an integer from 1 to 64');
    expect(() => runCpuSchedulerQueueUtilizationMismatchTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuSchedulerQueueUtilizationMismatchTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runCpuSchedulerQueueUtilizationMismatchTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuSchedulerQueueUtilizationMismatchTurbo([
      snapshot(1, 1, 4, { cpu: null }), snapshot(1, 1)
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
