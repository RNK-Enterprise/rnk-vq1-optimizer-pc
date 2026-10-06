import {
  GPU_OCCUPANCY_DRIFT_LIBRARY_ID,
  GPU_OCCUPANCY_DRIFT_LIBRARY_VERSION,
  buildGpuOccupancyDriftEnvelope,
  buildGpuOccupancyDriftPlan,
  createGpuOccupancyDriftLibrary,
  mergeGpuOccupancyDriftReports
} from '../pc/engines/gpu-memory/turbos/occupancy-drift/library.js';

function report(overrides = {}) {
  return {
    turbo: 'gpu-memory.occupancy-drift',
    state: 'stable-occupancy',
    sampleCount: 4,
    minimumSamples: 2,
    observedCount: 4,
    invalidCount: 0,
    incompleteCount: 0,
    noGpuCount: 0,
    deltaCount: 0,
    comparisonCount: 3,
    maximumDelta: 0,
    deltaThreshold: 10,
    changeThreshold: 1,
    confidence: 1,
    ...overrides
  };
}

describe('gpu-memory occupancy-drift library', () => {
  test('publishes identity and merges occupancy evidence', () => {
    const merged = mergeGpuOccupancyDriftReports([
      report({ sampleCount: 2, observedCount: 2, deltaCount: 1, comparisonCount: 1,
        maximumDelta: 20 }),
      report({ state: 'sustained-occupancy-drift', sampleCount: 6, observedCount: 5,
        deltaCount: 3, comparisonCount: 5, maximumDelta: 70, confidence: 0.8333 })
    ]);

    expect(GPU_OCCUPANCY_DRIFT_LIBRARY_ID).toBe('gpu-memory.occupancy-drift.library');
    expect(GPU_OCCUPANCY_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'sustained-occupancy-drift',
      sampleCount: 8,
      observedCount: 7,
      deltaCount: 4,
      comparisonCount: 6,
      maximumDelta: 70,
      confidence: 0.875,
      recommendations: ['review-vram-workload-pattern', 'hold-unapproved-memory-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeGpuOccupancyDriftReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      maximumDelta: 0, recommendations: ['collect-more-vram-occupancy-samples']
    });
    expect(mergeGpuOccupancyDriftReports([report({ state: 'no-gpu', sampleCount: 0,
      observedCount: 0, comparisonCount: 0, confidence: 0 })])).toMatchObject({
      state: 'no-gpu', confidence: 0, recommendations: ['no-change', 'keep-gpu-memory-controls-disabled']
    });
    expect(mergeGpuOccupancyDriftReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, comparisonCount: 0, confidence: 0 })])).toMatchObject({
      state: 'no-observation', recommendations: ['request-vram-occupancy-observation']
    });
    expect(mergeGpuOccupancyDriftReports([report({ state: 'invalid-vram-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-vram-evidence', recommendations: ['review-vram-counter-range'] });
    expect(mergeGpuOccupancyDriftReports([report({ state: 'incomplete-vram-evidence', incompleteCount: 1 })]))
      .toMatchObject({ state: 'incomplete-vram-evidence', recommendations: ['request-complete-vram-evidence'] });
    expect(mergeGpuOccupancyDriftReports([report({ state: 'occupancy-drift-observed', deltaCount: 1 })]))
      .toMatchObject({ state: 'occupancy-drift-observed', recommendations: ['observe-next-vram-sample'] });
    expect(mergeGpuOccupancyDriftReports([report()])).toMatchObject({
      state: 'stable-occupancy', recommendations: ['no-change']
    });
    expect(mergeGpuOccupancyDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, comparisonCount: 0, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeGpuOccupancyDriftReports([
      report({ state: 'no-gpu', sampleCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, comparisonCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeGpuOccupancyDriftReports([
      report({ state: 'sustained-occupancy-drift', deltaCount: 1 }),
      report({ state: 'invalid-vram-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-vram-evidence' });
    const states = [
      ['sustained-occupancy-drift', 'occupancy-workload-review', 750],
      ['occupancy-drift-observed', 'occupancy-observation', 1000],
      ['stable-occupancy', 'stable-occupancy-observation', 5000],
      ['invalid-vram-evidence', 'counter-review', 500],
      ['incomplete-vram-evidence', 'evidence-bootstrap', 1500],
      ['no-gpu', 'no-gpu-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildGpuOccupancyDriftPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildGpuOccupancyDriftPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildGpuOccupancyDriftPlan(report({ sampleCount: 0, observedCount: 0,
      comparisonCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildGpuOccupancyDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: GPU_OCCUPANCY_DRIFT_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuOccupancyDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(GPU_OCCUPANCY_DRIFT_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      comparisonCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeGpuOccupancyDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeGpuOccupancyDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeGpuOccupancyDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeGpuOccupancyDriftReports([[]])).toThrow('report must be an object');
    expect(() => mergeGpuOccupancyDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires an occupancy-drift turbo report');
    expect(() => mergeGpuOccupancyDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeGpuOccupancyDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'invalidCount', 'incompleteCount', 'noGpuCount',
      'deltaCount', 'comparisonCount']) {
      expect(() => mergeGpuOccupancyDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeGpuOccupancyDriftReports([report({ maximumDelta: -1 })]))
      .toThrow('maximumDelta must be between 0 and 100');
    expect(() => mergeGpuOccupancyDriftReports([report({ maximumDelta: 101 })]))
      .toThrow('maximumDelta must be between 0 and 100');
    expect(() => mergeGpuOccupancyDriftReports([report({ deltaThreshold: 101 })]))
      .toThrow('deltaThreshold must be between 0 and 100');
    expect(() => mergeGpuOccupancyDriftReports([report({ changeThreshold: 0 })]))
      .toThrow('changeThreshold must be from 1 to 64');
    expect(() => mergeGpuOccupancyDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildGpuOccupancyDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildGpuOccupancyDriftEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildGpuOccupancyDriftEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildGpuOccupancyDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
