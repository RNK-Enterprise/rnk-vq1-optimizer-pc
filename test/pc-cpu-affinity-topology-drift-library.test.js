import {
  CPU_AFFINITY_TOPOLOGY_LIBRARY_ID,
  CPU_AFFINITY_TOPOLOGY_LIBRARY_VERSION,
  buildCpuAffinityTopologyEnvelope,
  buildCpuAffinityTopologyPlan,
  createCpuAffinityTopologyLibrary,
  mergeCpuAffinityTopologyReports
} from '../pc/engines/cpu-affinity/turbos/topology-drift/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-affinity.topology-drift',
    state: 'stable-topology',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    comparisonCount: 3,
    changeCount: 1,
    changeRate: 0.3333,
    inconsistentCount: 0,
    ...overrides
  };
}

describe('CPU-affinity topology-drift library', () => {
  test('publishes identity and merges weighted topology evidence', () => {
    const merged = mergeCpuAffinityTopologyReports([
      report({ state: 'topology-watch', sampleCount: 2, observedCount: 2,
        comparisonCount: 1, changeCount: 1, changeRate: 0.5 }),
      report({ state: 'frequent-drift', sampleCount: 6, observedCount: 5,
        unknownCount: 1, comparisonCount: 5, changeCount: 4, changeRate: 0.8,
        inconsistentCount: 1 })
    ]);
    expect(CPU_AFFINITY_TOPOLOGY_LIBRARY_ID).toBe('cpu-affinity.topology-drift.library');
    expect(CPU_AFFINITY_TOPOLOGY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'frequent-drift',
      observedCount: 7, unknownCount: 1, comparisonCount: 6, changeCount: 5,
      inconsistentCount: 1, changeRate: 0.725, sampleCount: 8, confidence: 0.875,
      recommendations: ['observe-topology-change-duration'] });
  });

  test('preserves every aggregate state and zero-sample confidence', () => {
    expect(mergeCpuAffinityTopologyReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0, recommendations: ['collect-more-topology-samples']
    });
    expect(mergeCpuAffinityTopologyReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, changeCount: 0,
      changeRate: 0, inconsistentCount: 0 })])).toMatchObject({ state: 'no-observation', confidence: 0,
      recommendations: ['request-cpu-topology-observation'] });
    expect(mergeCpuAffinityTopologyReports([report({ state: 'inconsistent-topology', inconsistentCount: 1 })]))
      .toMatchObject({ state: 'inconsistent-topology', recommendations: ['reject-unverified-topology-change'] });
    expect(mergeCpuAffinityTopologyReports([report({ state: 'topology-watch' })]))
      .toMatchObject({ state: 'topology-watch', recommendations: ['observe-next-topology-sample'] });
    expect(mergeCpuAffinityTopologyReports([report({ state: 'stable-topology' })]))
      .toMatchObject({ state: 'stable-topology', recommendations: ['no-change'] });
    expect(mergeCpuAffinityTopologyReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, comparisonCount: 0, changeCount: 0,
      changeRate: 0, inconsistentCount: 0 })])).toMatchObject({ state: 'insufficient-data' });
  });

  test('builds state-specific plans, envelopes, and a frozen factory', () => {
    expect(buildCpuAffinityTopologyPlan(report({ state: 'inconsistent-topology' }), 'interactive'))
      .toMatchObject({ mode: 'topology-review', intervalMs: 500 });
    expect(buildCpuAffinityTopologyPlan(report({ state: 'frequent-drift' }), 'headless'))
      .toMatchObject({ mode: 'change-observation', intervalMs: 750 });
    expect(buildCpuAffinityTopologyPlan(report({ state: 'topology-watch' }), 'interactive'))
      .toMatchObject({ mode: 'trend-observation', intervalMs: 1000 });
    expect(buildCpuAffinityTopologyPlan(report({ state: 'no-observation' }), 'interactive'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000 });
    expect(buildCpuAffinityTopologyPlan(report({ state: 'insufficient-data' }), 'interactive'))
      .toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuAffinityTopologyPlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuAffinityTopologyPlan(report({ observedCount: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
    const envelope = buildCpuAffinityTopologyEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: CPU_AFFINITY_TOPOLOGY_LIBRARY_ID,
      trigger: 'health.interval', generatedAt: new Date(0).toISOString() });
    const factory = createCpuAffinityTopologyLibrary();
    expect(Object.isFrozen(factory)).toBe(true);
    expect(factory.id).toBe(CPU_AFFINITY_TOPOLOGY_LIBRARY_ID);
    expect(factory.version).toBe(1);
    expect(factory.merge([])).toMatchObject({ state: 'insufficient-data' });
  });

  test('rejects malformed reports, limits, fields, triggers, and clocks', () => {
    expect(() => mergeCpuAffinityTopologyReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuAffinityTopologyReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuAffinityTopologyReports([report({ turbo: 'other' })]))
      .toThrow('requires a topology-drift turbo report');
    expect(() => mergeCpuAffinityTopologyReports([report({ state: 'bad' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuAffinityTopologyReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuAffinityTopologyReports([report({ observedCount: 5 })]))
      .toThrow('observed count must fit');
    expect(() => mergeCpuAffinityTopologyReports([report({ unknownCount: 5 })]))
      .toThrow('unknown count must fit');
    expect(() => mergeCpuAffinityTopologyReports([report({ comparisonCount: 5 })]))
      .toThrow('comparison count must fit');
    expect(() => mergeCpuAffinityTopologyReports([report({ changeCount: 5 })]))
      .toThrow('change count must fit');
    expect(() => mergeCpuAffinityTopologyReports([report({ inconsistentCount: 5 })]))
      .toThrow('inconsistent count must fit');
    expect(() => mergeCpuAffinityTopologyReports([report({ changeRate: 2 })]))
      .toThrow('changeRate must be between');
    expect(() => buildCpuAffinityTopologyEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuAffinityTopologyEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => mergeCpuAffinityTopologyReports([null])).toThrow('report must be an object');
  });
});
