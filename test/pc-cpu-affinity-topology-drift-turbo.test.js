import {
  CPU_AFFINITY_TOPOLOGY_TRIGGERS,
  CPU_AFFINITY_TOPOLOGY_TURBO_ID,
  CPU_AFFINITY_TOPOLOGY_TURBO_VERSION,
  runCpuAffinityTopologyDriftTurbo
} from '../pc/engines/cpu-affinity/turbos/topology-drift/turbo.js';

function snapshot(physicalCpus, logicalCpus, sockets, overrides = {}) {
  return {
    engine: 'system-facts',
    cpu: { physicalCpus, logicalCpus, sockets },
    ...overrides
  };
}

describe('CPU-affinity topology-drift turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(CPU_AFFINITY_TOPOLOGY_TURBO_ID).toBe('cpu-affinity.topology-drift');
    expect(CPU_AFFINITY_TOPOLOGY_TURBO_VERSION).toBe(1);
    expect(CPU_AFFINITY_TOPOLOGY_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_AFFINITY_TOPOLOGY_TRIGGERS)).toBe(true);
  });

  test('classifies stable, inconsistent, frequent, and watch topology', () => {
    const stable = runCpuAffinityTopologyDriftTurbo([
      snapshot(4, 8, 1), snapshot(4, 8, 1), snapshot(4, 8, 1)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(stable).toMatchObject({ sampleCount: 3, observedCount: 3, unknownCount: 0,
      comparisonCount: 2, changeCount: 0, changeRate: 0, inconsistentCount: 0,
      state: 'stable-topology', confidence: 1, recommendations: ['no-change'], actions: [] });

    const inconsistent = runCpuAffinityTopologyDriftTurbo([
      snapshot(8, 4, 1), snapshot(8, 4, 1)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(inconsistent).toMatchObject({ inconsistentCount: 2, state: 'inconsistent-topology',
      recommendations: ['reject-unverified-topology-change'] });

    const frequent = runCpuAffinityTopologyDriftTurbo([
      snapshot(4, 8, 1), snapshot(2, 4, 1), snapshot(4, 8, 1), snapshot(2, 4, 1)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(frequent).toMatchObject({ comparisonCount: 3, changeCount: 3, changeRate: 1,
      state: 'frequent-drift', recommendations: ['observe-topology-change-duration'] });

    const watch = runCpuAffinityTopologyDriftTurbo([
      snapshot(4, 8, 1), snapshot(4, 8, 2), snapshot(4, 8, 2), snapshot(4, 8, 2)
    ], { trigger: 'health.interval', changeThreshold: 3, changeRateThreshold: 0.3, now: () => 0 });
    expect(watch).toMatchObject({ comparisonCount: 3, changeCount: 1, changeRate: 0.3333,
      state: 'topology-watch', recommendations: ['observe-next-topology-sample'] });
    expect(Object.isFrozen(stable)).toBe(true);
    expect(Object.isFrozen(stable.actions)).toBe(true);
  });

  test('bounds windows and preserves sparse, empty, and unknown evidence', () => {
    const empty = runCpuAffinityTopologyDriftTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-topology-samples'] });

    const bounded = runCpuAffinityTopologyDriftTurbo([
      snapshot(4, 8, 1), snapshot(2, 4, 1), snapshot(8, 16, 1), snapshot(4, 8, 1)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, comparisonCount: 1, changeCount: 1 });

    const insufficient = runCpuAffinityTopologyDriftTurbo([snapshot(4, 8, 1)], {
      trigger: 'health.interval', minimumSamples: 2, now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const unknown = runCpuAffinityTopologyDriftTurbo([
      snapshot(null, null, null), snapshot('bad', 'bad', 'bad')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2,
      comparisonCount: 0, changeCount: 0, state: 'no-observation', confidence: 0,
      recommendations: ['request-cpu-topology-observation'] });

    const partial = runCpuAffinityTopologyDriftTurbo([
      snapshot(4, 8, null), snapshot(4, 8, 1), snapshot(4, 8, 1)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(partial).toMatchObject({ observedCount: 2, unknownCount: 1, comparisonCount: 1 });
  });

  test('rejects malformed inputs, limits, thresholds, snapshots, and clocks', () => {
    expect(() => runCpuAffinityTopologyDriftTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuAffinityTopologyDriftTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-affinity topology-drift trigger: bad');
    expect(() => runCpuAffinityTopologyDriftTurbo())
      .toThrow('Unsupported CPU-affinity topology-drift trigger: unknown');
    expect(() => runCpuAffinityTopologyDriftTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuAffinityTopologyDriftTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuAffinityTopologyDriftTurbo([], {
      trigger: 'health.interval', changeThreshold: 65
    })).toThrow('changeThreshold must be an integer from 1 to 64');
    expect(() => runCpuAffinityTopologyDriftTurbo([], {
      trigger: 'health.interval', changeRateThreshold: 1.1
    })).toThrow('changeRateThreshold must be between 0 and 1');
    expect(() => runCpuAffinityTopologyDriftTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuAffinityTopologyDriftTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runCpuAffinityTopologyDriftTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuAffinityTopologyDriftTurbo([
      snapshot(4, 8, 1, { cpu: null }), snapshot(4, 8, 1)
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
