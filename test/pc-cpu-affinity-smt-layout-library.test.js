import {
  CPU_AFFINITY_SMT_LIBRARY_ID,
  CPU_AFFINITY_SMT_LIBRARY_VERSION,
  buildCpuAffinitySmtEnvelope,
  buildCpuAffinitySmtPlan,
  createCpuAffinitySmtLibrary,
  mergeCpuAffinitySmtReports
} from '../pc/engines/cpu-affinity/turbos/smt-layout/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-affinity.smt-layout',
    state: 'stable-smt',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    inconsistentCount: 0,
    heavySampleCount: 1,
    peakRatio: 2,
    meanRatio: 1.5,
    ratioRange: 0.5,
    ...overrides
  };
}

describe('CPU-affinity smt-layout library', () => {
  test('publishes identity and merges weighted SMT evidence', () => {
    const merged = mergeCpuAffinitySmtReports([
      report({ state: 'ratio-shift', sampleCount: 2, observedCount: 2,
        heavySampleCount: 0, peakRatio: 1.5, meanRatio: 1.25, ratioRange: 0.5 }),
      report({ state: 'inconsistent-layout', sampleCount: 6, observedCount: 5,
        unknownCount: 1, heavySampleCount: 5, peakRatio: 2, meanRatio: 2,
        ratioRange: 0, inconsistentCount: 1 })
    ]);
    expect(CPU_AFFINITY_SMT_LIBRARY_ID).toBe('cpu-affinity.smt-layout.library');
    expect(CPU_AFFINITY_SMT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'inconsistent-layout',
      observedCount: 7, unknownCount: 1, inconsistentCount: 1, heavySampleCount: 5,
      peakRatio: 2, meanRatio: 1.8125, ratioRange: 0.5, sampleCount: 8,
      confidence: 0.875, recommendations: ['reject-unverified-smt-layout'] });
  });

  test('preserves every aggregate state and zero-sample confidence', () => {
    expect(mergeCpuAffinitySmtReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0, recommendations: ['collect-more-smt-samples']
    });
    expect(mergeCpuAffinitySmtReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, inconsistentCount: 0, heavySampleCount: 0,
      peakRatio: null, meanRatio: null, ratioRange: 0 })])).toMatchObject({
      state: 'no-observation', confidence: 0, recommendations: ['request-smt-topology-observation']
    });
    expect(mergeCpuAffinitySmtReports([report({ state: 'inconsistent-layout', inconsistentCount: 1 })]))
      .toMatchObject({ state: 'inconsistent-layout', recommendations: ['reject-unverified-smt-layout'] });
    expect(mergeCpuAffinitySmtReports([report({ state: 'heavy-smt' })]))
      .toMatchObject({ state: 'heavy-smt', recommendations: ['preserve-os-smt-layout'] });
    expect(mergeCpuAffinitySmtReports([report({ state: 'ratio-shift' })]))
      .toMatchObject({ state: 'ratio-shift', recommendations: ['observe-next-smt-sample'] });
    expect(mergeCpuAffinitySmtReports([report({ state: 'stable-smt' })]))
      .toMatchObject({ state: 'stable-smt', recommendations: ['no-change'] });
    expect(mergeCpuAffinitySmtReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, inconsistentCount: 0, heavySampleCount: 0,
      peakRatio: null, meanRatio: null, ratioRange: 0 })])).toMatchObject({ state: 'insufficient-data' });
  });

  test('builds state-specific plans, envelopes, and a frozen factory', () => {
    expect(buildCpuAffinitySmtPlan(report({ state: 'inconsistent-layout' }), 'interactive'))
      .toMatchObject({ mode: 'layout-review', intervalMs: 500 });
    expect(buildCpuAffinitySmtPlan(report({ state: 'heavy-smt' }), 'headless'))
      .toMatchObject({ mode: 'smt-preservation', intervalMs: 500 });
    expect(buildCpuAffinitySmtPlan(report({ state: 'ratio-shift' }), 'interactive'))
      .toMatchObject({ mode: 'trend-observation', intervalMs: 1000 });
    expect(buildCpuAffinitySmtPlan(report({ state: 'no-observation' }), 'interactive'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000 });
    expect(buildCpuAffinitySmtPlan(report({ state: 'insufficient-data' }), 'interactive'))
      .toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuAffinitySmtPlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuAffinitySmtPlan(report({ observedCount: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
    const envelope = buildCpuAffinitySmtEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: CPU_AFFINITY_SMT_LIBRARY_ID,
      trigger: 'health.interval', generatedAt: new Date(0).toISOString() });
    const factory = createCpuAffinitySmtLibrary();
    expect(Object.isFrozen(factory)).toBe(true);
    expect(factory.id).toBe(CPU_AFFINITY_SMT_LIBRARY_ID);
    expect(factory.version).toBe(1);
    expect(factory.merge([])).toMatchObject({ state: 'insufficient-data' });
  });

  test('rejects malformed reports, limits, fields, triggers, and clocks', () => {
    expect(() => mergeCpuAffinitySmtReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuAffinitySmtReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuAffinitySmtReports([report({ turbo: 'other' })]))
      .toThrow('requires an smt-layout turbo report');
    expect(() => mergeCpuAffinitySmtReports([report({ state: 'bad' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuAffinitySmtReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuAffinitySmtReports([report({ observedCount: 5 })]))
      .toThrow('observed count must fit');
    expect(() => mergeCpuAffinitySmtReports([report({ unknownCount: 5 })]))
      .toThrow('unknown count must fit');
    expect(() => mergeCpuAffinitySmtReports([report({ inconsistentCount: 5 })]))
      .toThrow('inconsistent count must fit');
    expect(() => mergeCpuAffinitySmtReports([report({ heavySampleCount: 5 })]))
      .toThrow('heavy sample count must fit');
    expect(() => mergeCpuAffinitySmtReports([report({ peakRatio: 9 })]))
      .toThrow('peak ratio must be null or between');
    expect(() => mergeCpuAffinitySmtReports([report({ meanRatio: -1 })]))
      .toThrow('mean ratio must be null or between');
    expect(() => mergeCpuAffinitySmtReports([report({ ratioRange: 9 })]))
      .toThrow('ratio range must be null or between');
    expect(() => buildCpuAffinitySmtEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuAffinitySmtEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => mergeCpuAffinitySmtReports([null])).toThrow('report must be an object');
  });
});
