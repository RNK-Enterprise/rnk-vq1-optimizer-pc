import {
  CPU_SCHEDULER_QUEUE_LIBRARY_ID,
  CPU_SCHEDULER_QUEUE_LIBRARY_VERSION,
  buildCpuSchedulerRunQueueEnvelope,
  buildCpuSchedulerRunQueuePlan,
  createCpuSchedulerRunQueueLibrary,
  mergeCpuSchedulerRunQueueReports
} from '../pc/engines/cpu-scheduler/turbos/run-queue-burst/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-scheduler.run-queue-burst',
    state: 'stable-window',
    sampleCount: 4,
    observedCount: 4,
    burstCount: 1,
    burstRate: 0.25,
    peakPressure: 2,
    meanPressure: 1,
    maximumRise: 0.5,
    longestHighRun: 1,
    ...overrides
  };
}

describe('CPU-scheduler run-queue-burst library', () => {
  test('publishes identity and merges weighted pressure evidence', () => {
    const merged = mergeCpuSchedulerRunQueueReports([
      report({ state: 'rising-pressure', sampleCount: 2, observedCount: 2,
        burstCount: 0, burstRate: 0, peakPressure: 2, meanPressure: 0.5,
        maximumRise: 1, longestHighRun: 0 }),
      report({ state: 'burst-detected', sampleCount: 6, observedCount: 5,
        burstCount: 4, burstRate: 0.5, peakPressure: 4, meanPressure: 2,
        maximumRise: 2, longestHighRun: 2 })
    ]);
    expect(CPU_SCHEDULER_QUEUE_LIBRARY_ID).toBe('cpu-scheduler.run-queue-burst.library');
    expect(CPU_SCHEDULER_QUEUE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'burst-detected',
      burstRate: 0.375, peakPressure: 4, meanPressure: 1.625,
      maximumRise: 2, longestHighRun: 2, sampleCount: 8, observedCount: 7,
      burstCount: 4, confidence: 0.875,
      recommendations: ['observe-run-queue-duration'] });
  });

  test('preserves every aggregate state and zero-sample confidence', () => {
    expect(mergeCpuSchedulerRunQueueReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0, recommendations: ['collect-more-scheduler-samples']
    });
    expect(mergeCpuSchedulerRunQueueReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, burstCount: 0, burstRate: 0, peakPressure: null, meanPressure: null,
      maximumRise: 0, longestHighRun: 0 })])).toMatchObject({
      state: 'no-observation', confidence: 0, recommendations: ['request-scheduler-observation']
    });
    expect(mergeCpuSchedulerRunQueueReports([report({ state: 'sustained-pressure' })]))
      .toMatchObject({ state: 'sustained-pressure', recommendations: ['protect-scheduler-headroom'] });
    expect(mergeCpuSchedulerRunQueueReports([report({ state: 'rising-pressure' })]))
      .toMatchObject({ state: 'rising-pressure', recommendations: ['observe-next-scheduler-sample'] });
    expect(mergeCpuSchedulerRunQueueReports([report({ state: 'stable-window' })]))
      .toMatchObject({ state: 'stable-window', recommendations: ['no-change'] });
    expect(mergeCpuSchedulerRunQueueReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, burstCount: 0, peakPressure: null, meanPressure: null,
      maximumRise: 0, longestHighRun: 0 })])).toMatchObject({ state: 'insufficient-data' });
  });

  test('builds state-specific plans, envelopes, and a frozen factory', () => {
    expect(buildCpuSchedulerRunQueuePlan(report({ state: 'sustained-pressure' }), 'interactive'))
      .toMatchObject({ mode: 'headroom-protection', intervalMs: 250 });
    expect(buildCpuSchedulerRunQueuePlan(report({ state: 'burst-detected' }), 'headless'))
      .toMatchObject({ mode: 'burst-observation', intervalMs: 500 });
    expect(buildCpuSchedulerRunQueuePlan(report({ state: 'rising-pressure' }), 'interactive'))
      .toMatchObject({ mode: 'trend-observation', intervalMs: 750 });
    expect(buildCpuSchedulerRunQueuePlan(report({ state: 'no-observation' }), 'interactive'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000 });
    expect(buildCpuSchedulerRunQueuePlan(report({ state: 'insufficient-data' }), 'interactive'))
      .toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuSchedulerRunQueuePlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuSchedulerRunQueuePlan(report({ observedCount: 0, burstCount: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
    const envelope = buildCpuSchedulerRunQueueEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: CPU_SCHEDULER_QUEUE_LIBRARY_ID,
      trigger: 'health.interval', generatedAt: new Date(0).toISOString() });
    const factory = createCpuSchedulerRunQueueLibrary();
    expect(Object.isFrozen(factory)).toBe(true);
    expect(factory.id).toBe(CPU_SCHEDULER_QUEUE_LIBRARY_ID);
    expect(factory.version).toBe(1);
    expect(factory.merge([])).toMatchObject({ state: 'insufficient-data' });
  });

  test('rejects malformed reports, limits, fields, triggers, and clocks', () => {
    expect(() => mergeCpuSchedulerRunQueueReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuSchedulerRunQueueReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuSchedulerRunQueueReports([report({ turbo: 'other' })]))
      .toThrow('requires a run-queue-burst turbo report');
    expect(() => mergeCpuSchedulerRunQueueReports([report({ state: 'bad' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuSchedulerRunQueueReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuSchedulerRunQueueReports([report({ observedCount: 5 })]))
      .toThrow('observedCount must fit');
    expect(() => mergeCpuSchedulerRunQueueReports([report({ burstCount: 5 })]))
      .toThrow('burstCount must fit');
    expect(() => mergeCpuSchedulerRunQueueReports([report({ burstRate: 2 })]))
      .toThrow('burstRate must be between');
    expect(() => mergeCpuSchedulerRunQueueReports([report({ peakPressure: 17 })]))
      .toThrow('peak must be null or between');
    expect(() => mergeCpuSchedulerRunQueueReports([report({ meanPressure: -1 })]))
      .toThrow('mean must be null or between');
    expect(() => mergeCpuSchedulerRunQueueReports([report({ maximumRise: 17 })]))
      .toThrow('maximumRise must be between');
    expect(() => mergeCpuSchedulerRunQueueReports([report({ longestHighRun: 5 })]))
      .toThrow('longestHighRun must fit');
    expect(() => buildCpuSchedulerRunQueueEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuSchedulerRunQueueEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => mergeCpuSchedulerRunQueueReports([null])).toThrow('report must be an object');
  });
});
