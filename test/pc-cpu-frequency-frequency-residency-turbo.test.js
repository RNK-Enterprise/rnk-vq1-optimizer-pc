import {
  CPU_FREQUENCY_RESIDENCY_TRIGGERS,
  CPU_FREQUENCY_RESIDENCY_TURBO_ID,
  CPU_FREQUENCY_RESIDENCY_TURBO_VERSION,
  cpuFrequencyResidencyBands,
  runCpuFrequencyResidencyTurbo
} from '../pc/engines/cpu-frequency/turbos/frequency-residency/turbo.js';

function snapshot(frequencyMHz, baseFrequencyMHz = 2500, utilizationPercent = 50,
  maxFrequencyMHz = 5000, overrides = {}) {
  return {
    engine: 'system-facts',
    cpu: { frequencyMHz, baseFrequencyMHz, maxFrequencyMHz, utilizationPercent },
    ...overrides
  };
}

describe('CPU-frequency frequency-residency turbo', () => {
  test('publishes immutable identity, triggers, and residency bands', () => {
    expect(CPU_FREQUENCY_RESIDENCY_TURBO_ID).toBe('cpu-frequency.frequency-residency');
    expect(CPU_FREQUENCY_RESIDENCY_TURBO_VERSION).toBe(1);
    expect(CPU_FREQUENCY_RESIDENCY_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_FREQUENCY_RESIDENCY_TRIGGERS)).toBe(true);
    expect(cpuFrequencyResidencyBands()).toEqual(['low', 'base', 'boost', 'invalid', 'unknown']);
    expect(Object.isFrozen(cpuFrequencyResidencyBands())).toBe(true);
  });

  test('classifies balanced, low-under-load, boost, and unstable residency', () => {
    const balanced = runCpuFrequencyResidencyTurbo([
      snapshot(2400, 2500, 20), snapshot(2500, 2500, 50), snapshot(2600, 2500, 60)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(balanced).toMatchObject({ sampleCount: 3, observedCount: 3,
      unknownCount: 0, invalidCount: 0, lowUnderLoadCount: 0, boostCount: 0,
      comparisonCount: 2, transitionCount: 0, averageRatio: 1,
      state: 'balanced-residency', confidence: 1, recommendations: ['no-change'], actions: [] });

    const low = runCpuFrequencyResidencyTurbo([
      snapshot(1500, 2500, 80), snapshot(1700, 2500, 95), snapshot(2500, 2500, 80)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(low).toMatchObject({ lowUnderLoadCount: 2, boostCount: 0,
      state: 'low-residency-under-load', recommendations: ['review-documented-frequency-control'] });

    const boost = runCpuFrequencyResidencyTurbo([
      snapshot(3000, 2500, 30), snapshot(2800, 2500, 40), snapshot(2500, 2500, 60)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(boost).toMatchObject({ boostCount: 2, state: 'sustained-boost-residency',
      recommendations: ['observe-boost-duration-and-thermal-state'] });

    const unstable = runCpuFrequencyResidencyTurbo([
      snapshot(2500, 2500, 20), snapshot(1500, 2500, 20),
      snapshot(3000, 2500, 20), snapshot(2500, 2500, 20)
    ], { trigger: 'health.interval', transitionCountThreshold: 3, now: () => 0 });
    expect(unstable).toMatchObject({ comparisonCount: 3, transitionCount: 3,
      state: 'unstable-residency', recommendations: ['observe-frequency-residency-stability'] });
    expect(Object.isFrozen(balanced)).toBe(true);
    expect(Object.isFrozen(balanced.actions)).toBe(true);
  });

  test('bounds windows, handles sparse evidence, and uses maximum fallback', () => {
    const empty = runCpuFrequencyResidencyTurbo([], { trigger: 'health.interval', now: () => 0 });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      invalidCount: 0, averageRatio: null, state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-frequency-samples'] });

    const insufficient = runCpuFrequencyResidencyTurbo([snapshot(2500)], {
      trigger: 'health.interval', now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const bounded = runCpuFrequencyResidencyTurbo([
      snapshot(1500, 2500, 80), snapshot(2500), snapshot(3000), snapshot(2500)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, observedCount: 2, boostCount: 1 });

    const fallback = runCpuFrequencyResidencyTurbo([
      snapshot(2000, null, 50, 4000), snapshot(4000, null, 50, 4000)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(fallback).toMatchObject({ observedCount: 2, averageRatio: 0.75,
      state: 'balanced-residency' });

    const unknown = runCpuFrequencyResidencyTurbo([
      snapshot(null, null, null, null), snapshot(0, 0, 'bad', -1)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, invalidCount: 0,
      averageRatio: null, state: 'no-observation', confidence: 0,
      recommendations: ['request-frequency-residency-observation'] });

    const normalized = runCpuFrequencyResidencyTurbo([
      snapshot(1200, 2000, 120, 5000), snapshot(2000, 2000, -10, 5000)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(normalized).toMatchObject({ observedCount: 2, lowUnderLoadCount: 1, averageRatio: 0.8 });
  });

  test('rejects invalid frequency evidence and preserves conservative refusal state', () => {
    const invalid = runCpuFrequencyResidencyTurbo([
      snapshot(5200, 2500, 50, 5000), snapshot(2500, 2500, 50, 5000)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(invalid).toMatchObject({ observedCount: 1, unknownCount: 0, invalidCount: 1,
      state: 'invalid-frequency-evidence', recommendations: ['review-frequency-sensor-range'] });
  });

  test('rejects malformed inputs, bounds, snapshots, and clocks', () => {
    expect(() => runCpuFrequencyResidencyTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuFrequencyResidencyTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-frequency frequency-residency trigger: bad');
    expect(() => runCpuFrequencyResidencyTurbo()).toThrow(
      'Unsupported CPU-frequency frequency-residency trigger: unknown'
    );
    expect(() => runCpuFrequencyResidencyTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuFrequencyResidencyTurbo([], {
      trigger: 'health.interval', windowSize: 65
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuFrequencyResidencyTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuFrequencyResidencyTurbo([], {
      trigger: 'health.interval', minimumSamples: 0
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuFrequencyResidencyTurbo([], {
      trigger: 'health.interval', lowResidencyRatio: -0.1
    })).toThrow('lowResidencyRatio must be between 0 and 1');
    expect(() => runCpuFrequencyResidencyTurbo([], {
      trigger: 'health.interval', lowResidencyRatio: 1.1
    })).toThrow('lowResidencyRatio must be between 0 and 1');
    expect(() => runCpuFrequencyResidencyTurbo([], {
      trigger: 'health.interval', boostResidencyRatio: 0.9
    })).toThrow('boostResidencyRatio must be between 1 and 2');
    expect(() => runCpuFrequencyResidencyTurbo([], {
      trigger: 'health.interval', boostResidencyRatio: 2.1
    })).toThrow('boostResidencyRatio must be between 1 and 2');
    expect(() => runCpuFrequencyResidencyTurbo([], {
      trigger: 'health.interval', highUtilizationThreshold: -1
    })).toThrow('highUtilizationThreshold must be between 0 and 100');
    expect(() => runCpuFrequencyResidencyTurbo([], {
      trigger: 'health.interval', highUtilizationThreshold: 101
    })).toThrow('highUtilizationThreshold must be between 0 and 100');
    for (const option of ['lowCountThreshold', 'boostCountThreshold', 'transitionCountThreshold']) {
      expect(() => runCpuFrequencyResidencyTurbo([], {
        trigger: 'health.interval', [option]: 0
      })).toThrow(`${option} must be an integer from 1 to 64`);
      expect(() => runCpuFrequencyResidencyTurbo([], {
        trigger: 'health.interval', [option]: 65
      })).toThrow(`${option} must be an integer from 1 to 64`);
    }
    expect(() => runCpuFrequencyResidencyTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuFrequencyResidencyTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runCpuFrequencyResidencyTurbo([
      { engine: 'other' }, snapshot(2500)
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuFrequencyResidencyTurbo([
      snapshot(2500, 2500, 50, 5000, { cpu: null }), snapshot(2500)
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
