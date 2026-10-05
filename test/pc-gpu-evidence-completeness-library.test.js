import {
  GPU_EVIDENCE_COMPLETENESS_LIBRARY_ID,
  GPU_EVIDENCE_COMPLETENESS_LIBRARY_VERSION,
  buildGpuEvidenceCompletenessEnvelope,
  buildGpuEvidenceCompletenessPlan,
  createGpuEvidenceCompletenessLibrary,
  mergeGpuEvidenceCompletenessReports
} from '../pc/engines/gpu-policy/turbos/evidence-completeness/library.js';

function report(overrides = {}) {
  return {
    turbo: 'gpu-policy.evidence-completeness',
    state: 'complete-evidence-stable',
    sampleCount: 4,
    minimumSamples: 2,
    persistenceThreshold: 2,
    usableCount: 4,
    completeCount: 4,
    incompleteCount: 0,
    noGpuCount: 0,
    transitionCount: 0,
    missingFields: [],
    confidence: 1,
    ...overrides
  };
}

describe('gpu-policy evidence-completeness library', () => {
  test('publishes identity and merges evidence completeness', () => {
    const merged = mergeGpuEvidenceCompletenessReports([
      report({ sampleCount: 2, usableCount: 2, completeCount: 1,
        incompleteCount: 1, transitionCount: 1, missingFields: ['model'] }),
      report({ state: 'completeness-drift', sampleCount: 6, usableCount: 5,
        completeCount: 2, incompleteCount: 4, transitionCount: 2,
        missingFields: ['vendor'], confidence: 0.8333 })
    ]);

    expect(GPU_EVIDENCE_COMPLETENESS_LIBRARY_ID).toBe('gpu-policy.evidence-completeness.library');
    expect(GPU_EVIDENCE_COMPLETENESS_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'completeness-drift',
      sampleCount: 8,
      usableCount: 7,
      completeCount: 3,
      incompleteCount: 5,
      transitionCount: 3,
      missingFields: ['model', 'vendor'],
      confidence: 0.875,
      recommendations: ['review-gpu-evidence-source-stability', 'hold-unapproved-gpu-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.missingFields)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeGpuEvidenceCompletenessReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      recommendations: ['collect-more-gpu-evidence-samples']
    });
    expect(mergeGpuEvidenceCompletenessReports([report({ state: 'no-gpu', sampleCount: 0,
      usableCount: 0, completeCount: 0, missingFields: [], confidence: 0 })]))
      .toMatchObject({ state: 'no-gpu', confidence: 0,
        recommendations: ['no-change', 'keep-gpu-controls-disabled'] });
    expect(mergeGpuEvidenceCompletenessReports([report({ state: 'inventory-boundary-drift',
      noGpuCount: 1 })])).toMatchObject({ state: 'inventory-boundary-drift',
      recommendations: ['review-gpu-inventory-boundary', 'hold-unapproved-gpu-policy'] });
    expect(mergeGpuEvidenceCompletenessReports([report({ state: 'incomplete-evidence-persistent',
      incompleteCount: 2, missingFields: ['vendor'] })])).toMatchObject({
      state: 'incomplete-evidence-persistent',
      recommendations: ['request-complete-gpu-evidence', 'hold-unapproved-gpu-policy']
    });
    expect(mergeGpuEvidenceCompletenessReports([report({ state: 'incomplete-evidence-observed',
      incompleteCount: 1, missingFields: ['driver'] })])).toMatchObject({
      state: 'incomplete-evidence-observed', recommendations: ['observe-next-gpu-evidence-sample']
    });
    expect(mergeGpuEvidenceCompletenessReports([report()])).toMatchObject({
      state: 'complete-evidence-stable', recommendations: ['no-change']
    });
    expect(mergeGpuEvidenceCompletenessReports([report({ state: 'insufficient-data', sampleCount: 1,
      usableCount: 0, completeCount: 0, missingFields: [], confidence: 0 })]))
      .toMatchObject({ state: 'insufficient-data' });
    expect(mergeGpuEvidenceCompletenessReports([
      report({ state: 'no-gpu', sampleCount: 0, usableCount: 0, completeCount: 0,
        missingFields: [], confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, usableCount: 0,
        completeCount: 0, missingFields: [], confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeGpuEvidenceCompletenessReports([
      report({ state: 'completeness-drift', transitionCount: 1 }),
      report({ state: 'inventory-boundary-drift', noGpuCount: 1 })
    ])).toMatchObject({ state: 'inventory-boundary-drift' });
    const states = [
      ['completeness-drift', 'evidence-source-review', 750],
      ['incomplete-evidence-persistent', 'evidence-completion-review', 1250],
      ['incomplete-evidence-observed', 'evidence-observation', 1500],
      ['complete-evidence-stable', 'complete-evidence-observation', 5000],
      ['inventory-boundary-drift', 'inventory-boundary-review', 1000],
      ['no-gpu', 'no-gpu-observation', 10000],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildGpuEvidenceCompletenessPlan(report({ state, usableCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildGpuEvidenceCompletenessPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildGpuEvidenceCompletenessPlan(report({ sampleCount: 0, usableCount: 0,
      completeCount: 0, missingFields: [], confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildGpuEvidenceCompletenessEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: GPU_EVIDENCE_COMPLETENESS_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuEvidenceCompletenessLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(GPU_EVIDENCE_COMPLETENESS_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, usableCount: 0,
      completeCount: 0, missingFields: [], confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeGpuEvidenceCompletenessReports(null)).toThrow('reports must be an array');
    expect(() => mergeGpuEvidenceCompletenessReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeGpuEvidenceCompletenessReports([null])).toThrow('report must be an object');
    expect(() => mergeGpuEvidenceCompletenessReports([[]])).toThrow('report must be an object');
    expect(() => mergeGpuEvidenceCompletenessReports([report({ turbo: 'other' })]))
      .toThrow('requires an evidence-completeness turbo report');
    expect(() => mergeGpuEvidenceCompletenessReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeGpuEvidenceCompletenessReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['usableCount', 'completeCount', 'incompleteCount', 'noGpuCount',
      'transitionCount']) {
      expect(() => mergeGpuEvidenceCompletenessReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeGpuEvidenceCompletenessReports([report({ missingFields: null })]))
      .toThrow('missingFields must be an array');
    expect(() => mergeGpuEvidenceCompletenessReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeGpuEvidenceCompletenessReports([report({ persistenceThreshold: 65 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeGpuEvidenceCompletenessReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeGpuEvidenceCompletenessReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildGpuEvidenceCompletenessEnvelope(report())).toThrow('trigger is required');
    expect(() => buildGpuEvidenceCompletenessEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildGpuEvidenceCompletenessEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildGpuEvidenceCompletenessEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
