import {
  GPU_OBSERVATION_BOUNDARY_LIBRARY_ID,
  GPU_OBSERVATION_BOUNDARY_LIBRARY_VERSION,
  buildGpuObservationBoundaryEnvelope,
  buildGpuObservationBoundaryPlan,
  createGpuObservationBoundaryLibrary,
  mergeGpuObservationBoundaryReports
} from '../pc/engines/gpu-policy/turbos/observation-boundary/library.js';

function report(overrides = {}) {
  return {
    turbo: 'gpu-policy.observation-boundary',
    state: 'observation-enabled-stable',
    sampleCount: 4,
    minimumSamples: 2,
    persistenceThreshold: 2,
    observedCount: 4,
    enabledCount: 4,
    disabledCount: 0,
    unknownCount: 0,
    noGpuCount: 0,
    transitionCount: 0,
    confidence: 1,
    ...overrides
  };
}

describe('gpu-policy observation-boundary library', () => {
  test('publishes identity and merges capability evidence', () => {
    const merged = mergeGpuObservationBoundaryReports([
      report({ sampleCount: 2, observedCount: 2, enabledCount: 1, disabledCount: 1,
        transitionCount: 1 }),
      report({ state: 'sustained-observation-boundary-drift', sampleCount: 6,
        observedCount: 5, enabledCount: 3, disabledCount: 2, transitionCount: 2,
        unknownCount: 1, confidence: 0.8333 })
    ]);

    expect(GPU_OBSERVATION_BOUNDARY_LIBRARY_ID).toBe('gpu-policy.observation-boundary.library');
    expect(GPU_OBSERVATION_BOUNDARY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'sustained-observation-boundary-drift',
      sampleCount: 8,
      observedCount: 7,
      enabledCount: 4,
      disabledCount: 3,
      transitionCount: 3,
      confidence: 0.875,
      recommendations: ['review-gpu-observation-stability', 'hold-unapproved-gpu-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeGpuObservationBoundaryReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      recommendations: ['collect-more-gpu-observation-samples']
    });
    expect(mergeGpuObservationBoundaryReports([report({ state: 'no-gpu', sampleCount: 0,
      observedCount: 0, enabledCount: 0, noGpuCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-gpu', confidence: 0,
        recommendations: ['no-change', 'keep-gpu-controls-disabled'] });
    expect(mergeGpuObservationBoundaryReports([report({ state: 'observation-unknown', unknownCount: 1 })]))
      .toMatchObject({ state: 'observation-unknown', recommendations: ['request-gpu-observation-capability-evidence'] });
    expect(mergeGpuObservationBoundaryReports([report({ state: 'observation-boundary-drift', noGpuCount: 1 })]))
      .toMatchObject({ state: 'observation-boundary-drift', recommendations: ['review-gpu-observation-boundary', 'hold-unapproved-gpu-policy'] });
    expect(mergeGpuObservationBoundaryReports([report({ state: 'observation-boundary-observed', transitionCount: 1 })]))
      .toMatchObject({ state: 'observation-boundary-observed', recommendations: ['observe-next-gpu-observation-sample'] });
    expect(mergeGpuObservationBoundaryReports([report({ state: 'observation-disabled-persistent',
      enabledCount: 0, disabledCount: 4 })]))
      .toMatchObject({ state: 'observation-disabled-persistent', recommendations: ['keep-gpu-observation-disabled'] });
    expect(mergeGpuObservationBoundaryReports([report()])).toMatchObject({
      state: 'observation-enabled-stable', recommendations: ['no-change']
    });
    expect(mergeGpuObservationBoundaryReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, enabledCount: 0, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeGpuObservationBoundaryReports([
      report({ state: 'no-gpu', sampleCount: 0, observedCount: 0,
        enabledCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0,
        enabledCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeGpuObservationBoundaryReports([
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0,
        enabledCount: 0, confidence: 0 }),
      report({ state: 'observation-enabled-stable' })
    ])).toMatchObject({ state: 'observation-enabled-stable' });
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeGpuObservationBoundaryReports([
      report({ state: 'sustained-observation-boundary-drift' }),
      report({ state: 'observation-unknown', unknownCount: 1 })
    ])).toMatchObject({ state: 'observation-unknown' });
    const states = [
      ['sustained-observation-boundary-drift', 'observation-stability-review', 750],
      ['observation-boundary-observed', 'observation-boundary-review', 1000],
      ['observation-enabled-stable', 'enabled-observation', 5000],
      ['observation-disabled-persistent', 'disabled-observation', 10000],
      ['observation-unknown', 'capability-bootstrap', 1500],
      ['observation-boundary-drift', 'inventory-boundary-review', 1250],
      ['no-gpu', 'no-gpu-observation', 10000],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildGpuObservationBoundaryPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildGpuObservationBoundaryPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildGpuObservationBoundaryPlan(report({ sampleCount: 0, observedCount: 0,
      enabledCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildGpuObservationBoundaryEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: GPU_OBSERVATION_BOUNDARY_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuObservationBoundaryLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(GPU_OBSERVATION_BOUNDARY_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      enabledCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeGpuObservationBoundaryReports(null)).toThrow('reports must be an array');
    expect(() => mergeGpuObservationBoundaryReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeGpuObservationBoundaryReports([null])).toThrow('report must be an object');
    expect(() => mergeGpuObservationBoundaryReports([[]])).toThrow('report must be an object');
    expect(() => mergeGpuObservationBoundaryReports([report({ turbo: 'other' })]))
      .toThrow('requires an observation-boundary turbo report');
    expect(() => mergeGpuObservationBoundaryReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeGpuObservationBoundaryReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'enabledCount', 'disabledCount', 'unknownCount',
      'noGpuCount', 'transitionCount']) {
      expect(() => mergeGpuObservationBoundaryReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeGpuObservationBoundaryReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeGpuObservationBoundaryReports([report({ persistenceThreshold: 65 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeGpuObservationBoundaryReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeGpuObservationBoundaryReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildGpuObservationBoundaryEnvelope(report())).toThrow('trigger is required');
    expect(() => buildGpuObservationBoundaryEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildGpuObservationBoundaryEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildGpuObservationBoundaryEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
