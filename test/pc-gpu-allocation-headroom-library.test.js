import {
  GPU_ALLOCATION_HEADROOM_LIBRARY_ID,
  GPU_ALLOCATION_HEADROOM_LIBRARY_VERSION,
  buildGpuAllocationHeadroomEnvelope,
  buildGpuAllocationHeadroomPlan,
  createGpuAllocationHeadroomLibrary,
  mergeGpuAllocationHeadroomReports
} from '../pc/engines/gpu-memory/turbos/allocation-headroom/library.js';

function report(overrides = {}) {
  return {
    turbo: 'gpu-memory.allocation-headroom',
    state: 'healthy-headroom',
    sampleCount: 4,
    minimumSamples: 2,
    persistenceThreshold: 2,
    criticalThreshold: 5,
    lowThreshold: 20,
    observedCount: 4,
    invalidCount: 0,
    incompleteCount: 0,
    noGpuCount: 0,
    criticalCount: 0,
    lowCount: 0,
    minimumHeadroom: 40,
    confidence: 1,
    ...overrides
  };
}

describe('gpu-memory allocation-headroom library', () => {
  test('publishes identity and merges VRAM headroom evidence', () => {
    const merged = mergeGpuAllocationHeadroomReports([
      report({ sampleCount: 2, observedCount: 2, lowCount: 1, minimumHeadroom: 15 }),
      report({ state: 'critical-headroom-sustained', sampleCount: 6, observedCount: 5,
        criticalCount: 3, lowCount: 0, minimumHeadroom: 1, confidence: 0.8333 })
    ]);

    expect(GPU_ALLOCATION_HEADROOM_LIBRARY_ID).toBe('gpu-memory.allocation-headroom.library');
    expect(GPU_ALLOCATION_HEADROOM_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'critical-headroom-sustained',
      sampleCount: 8,
      observedCount: 7,
      criticalCount: 3,
      lowCount: 1,
      minimumHeadroom: 1,
      confidence: 0.875,
      recommendations: ['protect-vram-headroom', 'hold-unapproved-memory-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeGpuAllocationHeadroomReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0, minimumHeadroom: 100,
      recommendations: ['collect-more-vram-headroom-samples']
    });
    expect(mergeGpuAllocationHeadroomReports([report({ state: 'no-gpu', sampleCount: 0,
      observedCount: 0, minimumHeadroom: 100, confidence: 0 })])).toMatchObject({
      state: 'no-gpu', confidence: 0, recommendations: ['no-change', 'keep-gpu-memory-controls-disabled']
    });
    expect(mergeGpuAllocationHeadroomReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, minimumHeadroom: 100, confidence: 0 })])).toMatchObject({
      state: 'no-observation', recommendations: ['request-vram-headroom-observation']
    });
    expect(mergeGpuAllocationHeadroomReports([report({ state: 'invalid-vram-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-vram-evidence', recommendations: ['review-vram-counter-range'] });
    expect(mergeGpuAllocationHeadroomReports([report({ state: 'incomplete-vram-evidence', incompleteCount: 1 })]))
      .toMatchObject({ state: 'incomplete-vram-evidence', recommendations: ['request-complete-vram-evidence'] });
    expect(mergeGpuAllocationHeadroomReports([report({ state: 'critical-headroom-observed', criticalCount: 1 })]))
      .toMatchObject({ state: 'critical-headroom-observed', recommendations: ['observe-next-vram-headroom-sample'] });
    expect(mergeGpuAllocationHeadroomReports([report({ state: 'low-headroom-sustained', lowCount: 2 })]))
      .toMatchObject({ state: 'low-headroom-sustained', recommendations: ['review-vram-allocation-pressure', 'hold-unapproved-memory-policy'] });
    expect(mergeGpuAllocationHeadroomReports([report({ state: 'low-headroom-observed', lowCount: 1 })]))
      .toMatchObject({ state: 'low-headroom-observed', recommendations: ['observe-next-vram-headroom-sample'] });
    expect(mergeGpuAllocationHeadroomReports([report()])).toMatchObject({
      state: 'healthy-headroom', recommendations: ['no-change']
    });
    expect(mergeGpuAllocationHeadroomReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, minimumHeadroom: 100, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeGpuAllocationHeadroomReports([
      report({ state: 'no-gpu', sampleCount: 0, observedCount: 0, minimumHeadroom: 100, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, minimumHeadroom: 100, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeGpuAllocationHeadroomReports([
      report({ state: 'critical-headroom-sustained', criticalCount: 1 }),
      report({ state: 'invalid-vram-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-vram-evidence' });
    const states = [
      ['critical-headroom-sustained', 'headroom-protection-review', 750],
      ['critical-headroom-observed', 'critical-headroom-observation', 1000],
      ['low-headroom-sustained', 'allocation-pressure-review', 1000],
      ['low-headroom-observed', 'low-headroom-observation', 1250],
      ['healthy-headroom', 'healthy-headroom-observation', 5000],
      ['invalid-vram-evidence', 'counter-review', 500],
      ['incomplete-vram-evidence', 'evidence-bootstrap', 1500],
      ['no-gpu', 'no-gpu-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildGpuAllocationHeadroomPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildGpuAllocationHeadroomPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildGpuAllocationHeadroomPlan(report({ sampleCount: 0, observedCount: 0,
      minimumHeadroom: 100, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildGpuAllocationHeadroomEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: GPU_ALLOCATION_HEADROOM_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuAllocationHeadroomLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(GPU_ALLOCATION_HEADROOM_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      minimumHeadroom: 100, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeGpuAllocationHeadroomReports(null)).toThrow('reports must be an array');
    expect(() => mergeGpuAllocationHeadroomReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeGpuAllocationHeadroomReports([null])).toThrow('report must be an object');
    expect(() => mergeGpuAllocationHeadroomReports([[]])).toThrow('report must be an object');
    expect(() => mergeGpuAllocationHeadroomReports([report({ turbo: 'other' })]))
      .toThrow('requires an allocation-headroom turbo report');
    expect(() => mergeGpuAllocationHeadroomReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeGpuAllocationHeadroomReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'invalidCount', 'incompleteCount', 'noGpuCount',
      'criticalCount', 'lowCount']) {
      expect(() => mergeGpuAllocationHeadroomReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeGpuAllocationHeadroomReports([report({ minimumHeadroom: -1 })]))
      .toThrow('minimumHeadroom must be between 0 and 100');
    expect(() => mergeGpuAllocationHeadroomReports([report({ criticalThreshold: 101 })]))
      .toThrow('thresholds must be between 0 and 100');
    expect(() => mergeGpuAllocationHeadroomReports([report({ criticalThreshold: 20, lowThreshold: 20 })]))
      .toThrow('lowThreshold must exceed criticalThreshold');
    expect(() => mergeGpuAllocationHeadroomReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeGpuAllocationHeadroomReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildGpuAllocationHeadroomEnvelope(report())).toThrow('trigger is required');
    expect(() => buildGpuAllocationHeadroomEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildGpuAllocationHeadroomEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildGpuAllocationHeadroomEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
