import {
  CPU_AFFINITY_ENGINE_ID,
  CPU_AFFINITY_ENGINE_VERSION,
  CPU_AFFINITY_TRIGGERS,
  runCpuAffinityEngine
} from '../pc/engines/cpu-affinity/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    cpu: {
      physicalCpus: 4,
      logicalCpus: 8,
      sockets: 1,
      utilizationPercent: 20
    },
    ...overrides
  };
}

describe('CPU-affinity engine', () => {
  test('publishes identity and triggers', () => {
    expect(CPU_AFFINITY_ENGINE_ID).toBe('cpu-affinity');
    expect(CPU_AFFINITY_ENGINE_VERSION).toBe(1);
    expect(CPU_AFFINITY_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(CPU_AFFINITY_TRIGGERS)).toBe(true);
  });

  test('reports SMT topology and preserves the operating-system layout', () => {
    const result = runCpuAffinityEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: CPU_AFFINITY_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      physicalCpus: 4,
      logicalCpus: 8,
      sockets: 1,
      topology: 'smt',
      risk: 'smt-layout',
      workloadProfile: 'balanced',
      confidence: 1,
      recommendations: ['preserve-os-smt-layout'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('recognizes single-thread and multi-socket topologies', () => {
    expect(runCpuAffinityEngine(facts({
      cpu: { physicalCpus: 8, logicalCpus: 8, sockets: 1, utilizationPercent: 20 }
    }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      topology: 'single-thread',
      risk: 'low',
      recommendations: ['no-change']
    });
    expect(runCpuAffinityEngine(facts({
      cpu: { physicalCpus: 4, logicalCpus: 6, sockets: 1, utilizationPercent: 20 }
    }), { trigger: 'workload.changed', now: () => 0 }).risk).toBe('observe');
    expect(runCpuAffinityEngine(facts({
      environment: 'headless',
      cpu: { physicalCpus: 8, logicalCpus: 16, sockets: 2, utilizationPercent: 70 }
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      topology: 'multi-socket',
      risk: 'review',
      workloadProfile: 'throughput',
      recommendations: ['review-numa-aware-affinity']
    });
  });

  test('rejects inconsistent topology and avoids unverified affinity changes', () => {
    expect(runCpuAffinityEngine(facts({
      cpu: { physicalCpus: 8, logicalCpus: 4, sockets: 1, utilizationPercent: 70 }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      topology: 'inconsistent',
      risk: 'review',
      workloadProfile: 'latency-sensitive',
      recommendations: ['reject-unverified-affinity-change']
    });
  });

  test('reports missing topology and profile data conservatively', () => {
    expect(runCpuAffinityEngine(facts({
      cpu: { utilizationPercent: 20 }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      topology: 'unknown',
      risk: 'review',
      confidence: 0.2,
      recommendations: ['request-topology-observation']
    });
    expect(runCpuAffinityEngine(facts({
      environment: 'other',
      cpu: { physicalCpus: 4, logicalCpus: 8, sockets: 1 }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      workloadProfile: 'profile-required',
      recommendations: ['request-environment-profile']
    });
    expect(runCpuAffinityEngine(facts({
      cpu: { physicalCpus: 4, logicalCpus: 8, utilizationPercent: 20 }
    }), { trigger: 'health.interval', now: () => 0 }).topology).toBe('socket-count-unknown');
  });

  test('reports unknown utilization and rejects malformed inputs', () => {
    expect(runCpuAffinityEngine(facts({
      cpu: { physicalCpus: 4, logicalCpus: 8, sockets: 1 }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      workloadProfile: 'observation-required',
      recommendations: ['request-cpu-observation']
    });
    expect(() => runCpuAffinityEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runCpuAffinityEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runCpuAffinityEngine(facts({ cpu: null }), { trigger: 'system.facts.request' }))
      .toThrow('require a CPU section');
    expect(() => runCpuAffinityEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported CPU-affinity trigger: bad');
    expect(() => runCpuAffinityEngine(facts(), {}))
      .toThrow('Unsupported CPU-affinity trigger: unknown');
    expect(() => runCpuAffinityEngine())
      .toThrow('Unsupported CPU-affinity trigger: unknown');
    expect(() => runCpuAffinityEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('CPU-affinity clock must return a number');
  });
});
