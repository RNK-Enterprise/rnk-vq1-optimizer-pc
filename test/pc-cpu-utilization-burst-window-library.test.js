import {
  CPU_UTILIZATION_BURST_LIBRARY_ID,
  CPU_UTILIZATION_BURST_LIBRARY_VERSION,
  buildCpuUtilizationBurstEnvelope,
  buildCpuUtilizationBurstPlan,
  createCpuUtilizationBurstLibrary,
  mergeCpuUtilizationBurstReports
} from '../pc/engines/cpu-utilization/turbos/burst-window/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-utilization.burst-window',
    state: 'stable-window',
    sampleCount: 4,
    observedCount: 4,
    burstCount: 0,
    burstRate: 0,
    peakUtilizationPercent: 40,
    maximumRisePercent: 10,
    ...overrides
  };
}

describe('CPU-utilization burst-window library', () => {
  test('publishes identity and merges weighted bounded reports', () => {
    const merged = mergeCpuUtilizationBurstReports([
      report({ state: 'rising-burst', sampleCount: 2, observedCount: 2, burstRate: 0.2,
        peakUtilizationPercent: 70, maximumRisePercent: 25 }),
      report({ state: 'burst-detected', sampleCount: 6, observedCount: 4, burstCount: 3,
        burstRate: 0.75, peakUtilizationPercent: 95, maximumRisePercent: 30 })
    ]);
    expect(merged).toMatchObject({
      library: CPU_UTILIZATION_BURST_LIBRARY_ID,
      libraryVersion: CPU_UTILIZATION_BURST_LIBRARY_VERSION,
      reportCount: 2, state: 'burst-detected', burstRate: 0.6125,
      peakUtilizationPercent: 95, maximumRisePercent: 30, sampleCount: 8,
      observedCount: 6, confidence: 0.75, recommendations: ['observe-burst-duration']
    });
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(createCpuUtilizationBurstLibrary())).toBe(true);
  });

  test('preserves empty, no-observation, stable, and insufficient aggregates', () => {
    expect(mergeCpuUtilizationBurstReports([])).toMatchObject({
      reportCount: 0, state: 'insufficient-data', burstRate: null,
      peakUtilizationPercent: null, maximumRisePercent: null, sampleCount: 0,
      observedCount: 0, confidence: 0, recommendations: ['collect-more-cpu-samples']
    });
    expect(mergeCpuUtilizationBurstReports([
      report({ state: 'no-observation', sampleCount: 2, observedCount: 0, burstCount: 0,
        burstRate: 0, peakUtilizationPercent: null, maximumRisePercent: 0 }),
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0, burstCount: 0,
        burstRate: 0, peakUtilizationPercent: null, maximumRisePercent: 0 })
    ])).toMatchObject({ state: 'no-observation', confidence: 0,
      recommendations: ['request-cpu-utilization-observation'] });
    expect(mergeCpuUtilizationBurstReports([report()])).toMatchObject({
      state: 'stable-window', confidence: 1, recommendations: ['no-change']
    });
    expect(mergeCpuUtilizationBurstReports([report({ state: 'rising-burst', maximumRisePercent: 25 })]))
      .toMatchObject({ state: 'rising-burst', recommendations: ['observe-next-cpu-sample'] });
    expect(mergeCpuUtilizationBurstReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, burstCount: 0, burstRate: 0, peakUtilizationPercent: null })]))
      .toMatchObject({ state: 'no-observation', confidence: 0 });
    expect(mergeCpuUtilizationBurstReports([
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 1, burstRate: 0.1 })
    ])).toMatchObject({ state: 'insufficient-data', confidence: 1,
      recommendations: ['collect-more-cpu-samples'] });
  });

  test('builds state-specific plans and immutable envelopes', () => {
    expect(buildCpuUtilizationBurstPlan(report({ state: 'burst-detected', observedCount: 4 }), 'interactive'))
      .toMatchObject({ environment: 'interactive', mode: 'burst-observation', intervalMs: 250, confidence: 1 });
    expect(buildCpuUtilizationBurstPlan(report({ state: 'rising-burst' }), 'headless'))
      .toMatchObject({ mode: 'trend-observation', intervalMs: 500 });
    expect(buildCpuUtilizationBurstPlan(report({ state: 'no-observation', observedCount: 0 }), 'headless'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000, confidence: 0 });
    expect(buildCpuUtilizationBurstPlan(report({ state: 'insufficient-data' }), 'interactive'))
      .toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuUtilizationBurstPlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuUtilizationBurstPlan(report(), 'unclassified')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', intervalMs: 5000
    });
    const envelope = buildCpuUtilizationBurstEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
  });

  test('rejects malformed reports, collections, triggers, clocks, and limits', () => {
    expect(() => mergeCpuUtilizationBurstReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuUtilizationBurstReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuUtilizationBurstReports([null])).toThrow('report must be an object');
    expect(() => mergeCpuUtilizationBurstReports([report({ turbo: 'other' })]))
      .toThrow('requires a burst-window turbo report');
    expect(() => mergeCpuUtilizationBurstReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuUtilizationBurstReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuUtilizationBurstReports([report({ observedCount: 5 })]))
      .toThrow('observedCount must fit');
    expect(() => mergeCpuUtilizationBurstReports([report({ burstCount: 5 })]))
      .toThrow('burstCount must fit');
    expect(() => mergeCpuUtilizationBurstReports([report({ burstRate: 2 })]))
      .toThrow('burstRate must be between');
    expect(() => mergeCpuUtilizationBurstReports([report({ peakUtilizationPercent: 101 })]))
      .toThrow('peak must be null or between');
    expect(() => mergeCpuUtilizationBurstReports([report({ maximumRisePercent: -1 })]))
      .toThrow('maximumRise must be between');
    expect(() => buildCpuUtilizationBurstEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuUtilizationBurstEnvelope(report(), { trigger: '', now: () => 0 }))
      .toThrow('trigger is required');
    expect(() => buildCpuUtilizationBurstEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
