import {
  GPU_COUNTER_INTEGRITY_LIBRARY_ID,
  GPU_COUNTER_INTEGRITY_LIBRARY_VERSION,
  buildGpuCounterIntegrityEnvelope,
  buildGpuCounterIntegrityPlan,
  createGpuCounterIntegrityLibrary,
  mergeGpuCounterIntegrityReports
} from '../pc/engines/gpu-memory/turbos/counter-integrity/library.js';

function report(overrides = {}) {
  return {
    turbo: 'gpu-memory.counter-integrity',
    state: 'consistent-counters',
    sampleCount: 4,
    minimumSamples: 2,
    persistenceThreshold: 2,
    tolerancePercent: 5,
    observedCount: 4,
    invalidCount: 0,
    incompleteCount: 0,
    noGpuCount: 0,
    inconsistentCount: 0,
    consistentCount: 4,
    maximumErrorPercent: 0,
    confidence: 1,
    ...overrides
  };
}

describe('gpu-memory counter-integrity library', () => {
  test('publishes identity and merges counter evidence', () => {
    const merged = mergeGpuCounterIntegrityReports([
      report({ sampleCount: 2, observedCount: 2, inconsistentCount: 1,
        consistentCount: 1, maximumErrorPercent: 10 }),
      report({ state: 'inconsistent-counters-sustained', sampleCount: 6, observedCount: 5,
        inconsistentCount: 3, consistentCount: 2, maximumErrorPercent: 20, confidence: 0.8333 })
    ]);

    expect(GPU_COUNTER_INTEGRITY_LIBRARY_ID).toBe('gpu-memory.counter-integrity.library');
    expect(GPU_COUNTER_INTEGRITY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'inconsistent-counters-sustained',
      sampleCount: 8,
      observedCount: 7,
      inconsistentCount: 4,
      consistentCount: 3,
      maximumErrorPercent: 20,
      confidence: 0.875,
      recommendations: ['review-vram-counter-source', 'hold-unapproved-memory-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeGpuCounterIntegrityReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0, maximumErrorPercent: 0,
      recommendations: ['collect-more-vram-counter-samples']
    });
    expect(mergeGpuCounterIntegrityReports([report({ state: 'no-gpu', sampleCount: 0,
      observedCount: 0, consistentCount: 0, confidence: 0 })])).toMatchObject({
      state: 'no-gpu', confidence: 0, recommendations: ['no-change', 'keep-gpu-memory-controls-disabled']
    });
    expect(mergeGpuCounterIntegrityReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, consistentCount: 0, confidence: 0 })])).toMatchObject({
      state: 'no-observation', recommendations: ['request-vram-counter-observation']
    });
    expect(mergeGpuCounterIntegrityReports([report({ state: 'invalid-vram-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-vram-evidence', recommendations: ['review-vram-counter-range'] });
    expect(mergeGpuCounterIntegrityReports([report({ state: 'incomplete-vram-evidence', incompleteCount: 1 })]))
      .toMatchObject({ state: 'incomplete-vram-evidence', recommendations: ['request-complete-vram-counters'] });
    expect(mergeGpuCounterIntegrityReports([report({ state: 'inconsistent-counters-observed', inconsistentCount: 1 })]))
      .toMatchObject({ state: 'inconsistent-counters-observed', recommendations: ['observe-next-vram-counter-sample'] });
    expect(mergeGpuCounterIntegrityReports([report()])).toMatchObject({
      state: 'consistent-counters', recommendations: ['no-change']
    });
    expect(mergeGpuCounterIntegrityReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, consistentCount: 0, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeGpuCounterIntegrityReports([
      report({ state: 'no-gpu', sampleCount: 0, observedCount: 0, consistentCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, consistentCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeGpuCounterIntegrityReports([
      report({ state: 'inconsistent-counters-sustained', inconsistentCount: 1 }),
      report({ state: 'invalid-vram-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-vram-evidence' });
    const states = [
      ['inconsistent-counters-sustained', 'counter-source-review', 750],
      ['inconsistent-counters-observed', 'counter-observation', 1000],
      ['consistent-counters', 'consistent-counter-observation', 5000],
      ['invalid-vram-evidence', 'counter-range-review', 500],
      ['incomplete-vram-evidence', 'evidence-bootstrap', 1500],
      ['no-gpu', 'no-gpu-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildGpuCounterIntegrityPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildGpuCounterIntegrityPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildGpuCounterIntegrityPlan(report({ sampleCount: 0, observedCount: 0,
      consistentCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildGpuCounterIntegrityEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: GPU_COUNTER_INTEGRITY_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuCounterIntegrityLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(GPU_COUNTER_INTEGRITY_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      consistentCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeGpuCounterIntegrityReports(null)).toThrow('reports must be an array');
    expect(() => mergeGpuCounterIntegrityReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeGpuCounterIntegrityReports([null])).toThrow('report must be an object');
    expect(() => mergeGpuCounterIntegrityReports([[]])).toThrow('report must be an object');
    expect(() => mergeGpuCounterIntegrityReports([report({ turbo: 'other' })]))
      .toThrow('requires a counter-integrity turbo report');
    expect(() => mergeGpuCounterIntegrityReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeGpuCounterIntegrityReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'invalidCount', 'incompleteCount', 'noGpuCount',
      'inconsistentCount', 'consistentCount']) {
      expect(() => mergeGpuCounterIntegrityReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeGpuCounterIntegrityReports([report({ maximumErrorPercent: -1 })]))
      .toThrow('maximumErrorPercent must be between 0 and 100');
    expect(() => mergeGpuCounterIntegrityReports([report({ tolerancePercent: 101 })]))
      .toThrow('tolerancePercent must be between 0 and 100');
    expect(() => mergeGpuCounterIntegrityReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeGpuCounterIntegrityReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildGpuCounterIntegrityEnvelope(report())).toThrow('trigger is required');
    expect(() => buildGpuCounterIntegrityEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildGpuCounterIntegrityEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildGpuCounterIntegrityEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
