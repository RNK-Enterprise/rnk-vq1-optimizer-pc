import {
  CPU_SCHEDULER_MISMATCH_LIBRARY_ID,
  CPU_SCHEDULER_MISMATCH_LIBRARY_VERSION,
  buildCpuSchedulerQueueUtilizationEnvelope,
  buildCpuSchedulerQueueUtilizationPlan,
  createCpuSchedulerQueueUtilizationLibrary,
  mergeCpuSchedulerQueueUtilizationReports
} from '../pc/engines/cpu-scheduler/turbos/queue-utilization-mismatch/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-scheduler.queue-utilization-mismatch',
    state: 'aligned-window',
    sampleCount: 4,
    observedCount: 4,
    mismatchRate: 0.25,
    queuedLowUtilizationCount: 1,
    busyLowQueueCount: 1,
    peakMismatch: 0.5,
    meanMismatch: 0.25,
    maximumRise: 0.25,
    ...overrides
  };
}

describe('CPU-scheduler queue-utilization-mismatch library', () => {
  test('publishes identity and merges weighted alignment evidence', () => {
    const merged = mergeCpuSchedulerQueueUtilizationReports([
      report({ state: 'rising-mismatch', sampleCount: 2, observedCount: 2,
        mismatchRate: 0, queuedLowUtilizationCount: 0, busyLowQueueCount: 0,
        peakMismatch: 0.5, meanMismatch: 0.1, maximumRise: 0.5 }),
      report({ state: 'mismatch-burst', sampleCount: 6, observedCount: 5,
        mismatchRate: 0.5, queuedLowUtilizationCount: 2, busyLowQueueCount: 1,
        peakMismatch: 0.8, meanMismatch: 0.4, maximumRise: 0.8 })
    ]);
    expect(CPU_SCHEDULER_MISMATCH_LIBRARY_ID).toBe('cpu-scheduler.queue-utilization-mismatch.library');
    expect(CPU_SCHEDULER_MISMATCH_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'mismatch-burst',
      mismatchRate: 0.375, peakMismatch: 0.8, meanMismatch: 0.325,
      maximumRise: 0.8, queuedLowUtilizationCount: 2, busyLowQueueCount: 1,
      sampleCount: 8, observedCount: 7, confidence: 0.875,
      recommendations: ['observe-queue-utilization-alignment'] });
  });

  test('preserves every aggregate state and zero-sample confidence', () => {
    expect(mergeCpuSchedulerQueueUtilizationReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0, recommendations: ['collect-more-scheduler-samples']
    });
    expect(mergeCpuSchedulerQueueUtilizationReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, mismatchRate: 0, queuedLowUtilizationCount: 0, busyLowQueueCount: 0,
      peakMismatch: null, meanMismatch: null, maximumRise: 0 })])).toMatchObject({
      state: 'no-observation', confidence: 0,
      recommendations: ['request-queue-utilization-observation']
    });
    expect(mergeCpuSchedulerQueueUtilizationReports([report({ state: 'queued-low-utilization' })]))
      .toMatchObject({ state: 'queued-low-utilization', recommendations: ['review-queue-or-idle-accounting'] });
    expect(mergeCpuSchedulerQueueUtilizationReports([report({ state: 'busy-low-queue' })]))
      .toMatchObject({ state: 'busy-low-queue', recommendations: ['review-utilization-or-queue-accounting'] });
    expect(mergeCpuSchedulerQueueUtilizationReports([report({ state: 'rising-mismatch' })]))
      .toMatchObject({ state: 'rising-mismatch', recommendations: ['observe-next-queue-utilization-sample'] });
    expect(mergeCpuSchedulerQueueUtilizationReports([report({ state: 'aligned-window' })]))
      .toMatchObject({ state: 'aligned-window', recommendations: ['no-change'] });
    expect(mergeCpuSchedulerQueueUtilizationReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, mismatchRate: 0, queuedLowUtilizationCount: 0, busyLowQueueCount: 0,
      peakMismatch: null, meanMismatch: null, maximumRise: 0 })])).toMatchObject({ state: 'insufficient-data' });
  });

  test('builds state-specific plans, envelopes, and a frozen factory', () => {
    expect(buildCpuSchedulerQueueUtilizationPlan(report({ state: 'queued-low-utilization' }), 'interactive'))
      .toMatchObject({ mode: 'queue-accounting-review', intervalMs: 500 });
    expect(buildCpuSchedulerQueueUtilizationPlan(report({ state: 'busy-low-queue' }), 'headless'))
      .toMatchObject({ mode: 'utilization-accounting-review', intervalMs: 500 });
    expect(buildCpuSchedulerQueueUtilizationPlan(report({ state: 'mismatch-burst' }), 'interactive'))
      .toMatchObject({ mode: 'alignment-observation', intervalMs: 750 });
    expect(buildCpuSchedulerQueueUtilizationPlan(report({ state: 'rising-mismatch' }), 'interactive'))
      .toMatchObject({ mode: 'trend-observation', intervalMs: 1000 });
    expect(buildCpuSchedulerQueueUtilizationPlan(report({ state: 'no-observation' }), 'interactive'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000 });
    expect(buildCpuSchedulerQueueUtilizationPlan(report({ state: 'insufficient-data' }), 'interactive'))
      .toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuSchedulerQueueUtilizationPlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuSchedulerQueueUtilizationPlan(report({ observedCount: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
    const envelope = buildCpuSchedulerQueueUtilizationEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: CPU_SCHEDULER_MISMATCH_LIBRARY_ID,
      trigger: 'health.interval', generatedAt: new Date(0).toISOString() });
    const factory = createCpuSchedulerQueueUtilizationLibrary();
    expect(Object.isFrozen(factory)).toBe(true);
    expect(factory.id).toBe(CPU_SCHEDULER_MISMATCH_LIBRARY_ID);
    expect(factory.version).toBe(1);
    expect(factory.merge([])).toMatchObject({ state: 'insufficient-data' });
  });

  test('rejects malformed reports, limits, fields, triggers, and clocks', () => {
    expect(() => mergeCpuSchedulerQueueUtilizationReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuSchedulerQueueUtilizationReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuSchedulerQueueUtilizationReports([report({ turbo: 'other' })]))
      .toThrow('requires a mismatch turbo report');
    expect(() => mergeCpuSchedulerQueueUtilizationReports([report({ state: 'bad' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuSchedulerQueueUtilizationReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuSchedulerQueueUtilizationReports([report({ observedCount: 5 })]))
      .toThrow('observedCount must fit');
    expect(() => mergeCpuSchedulerQueueUtilizationReports([report({ queuedLowUtilizationCount: 5 })]))
      .toThrow('queued count must fit');
    expect(() => mergeCpuSchedulerQueueUtilizationReports([report({ busyLowQueueCount: 5 })]))
      .toThrow('busy count must fit');
    expect(() => mergeCpuSchedulerQueueUtilizationReports([report({ mismatchRate: 2 })]))
      .toThrow('mismatchRate must be between');
    expect(() => mergeCpuSchedulerQueueUtilizationReports([report({ peakMismatch: 2 })]))
      .toThrow('peak must be null or between');
    expect(() => mergeCpuSchedulerQueueUtilizationReports([report({ meanMismatch: -1 })]))
      .toThrow('mean must be null or between');
    expect(() => mergeCpuSchedulerQueueUtilizationReports([report({ maximumRise: 2 })]))
      .toThrow('maximumRise must be between');
    expect(() => buildCpuSchedulerQueueUtilizationEnvelope(report()))
      .toThrow('trigger is required');
    expect(() => buildCpuSchedulerQueueUtilizationEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => mergeCpuSchedulerQueueUtilizationReports([null])).toThrow('report must be an object');
  });
});
