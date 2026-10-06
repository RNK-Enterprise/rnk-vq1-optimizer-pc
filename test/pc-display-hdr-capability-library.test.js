import {
  DISPLAY_HDR_CAPABILITY_LIBRARY_ID,
  DISPLAY_HDR_CAPABILITY_LIBRARY_VERSION,
  buildDisplayHdrCapabilityEnvelope,
  buildDisplayHdrCapabilityPlan,
  createDisplayHdrCapabilityLibrary,
  mergeDisplayHdrCapabilityReports
} from '../pc/engines/display-pipeline/turbos/hdr-capability/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'display-pipeline.hdr-capability',
    state: 'hdr-enabled',
    sampleCount,
    minimumSamples: 2,
    changeThreshold: 1,
    observedCount: sampleCount,
    enabledCount: sampleCount,
    disabledCount: 0,
    incompleteCount: 0,
    noDisplayCount: 0,
    noObservationCount: 0,
    transitionCount: 0,
    comparisonCount: Math.max(0, sampleCount - 1),
    latestHdr: sampleCount === 0 ? null : true,
    confidence: sampleCount === 0 ? 0 : 1,
    ...overrides
  };
}

describe('display-pipeline hdr-capability library', () => {
  test('publishes identity and merges HDR evidence', () => {
    const merged = mergeDisplayHdrCapabilityReports([
      report({ sampleCount: 2, observedCount: 2, enabledCount: 1, disabledCount: 1,
        transitionCount: 1, comparisonCount: 1, latestHdr: false }),
      report({ state: 'hdr-drift-sustained', sampleCount: 6, observedCount: 5,
        enabledCount: 3, disabledCount: 2, transitionCount: 3, comparisonCount: 5,
        latestHdr: true, confidence: 0.8333 })
    ]);
    expect(DISPLAY_HDR_CAPABILITY_LIBRARY_ID).toBe('display-pipeline.hdr-capability.library');
    expect(DISPLAY_HDR_CAPABILITY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'hdr-drift-sustained', sampleCount: 8,
      observedCount: 7, enabledCount: 4, disabledCount: 3, transitionCount: 4, comparisonCount: 6,
      latestHdr: true, confidence: 0.875, recommendations: ['review-hdr-stability', 'hold-unapproved-display-policy'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeDisplayHdrCapabilityReports([])).toMatchObject({ state: 'insufficient-data', reportCount: 0,
      confidence: 0, latestHdr: null, recommendations: ['collect-more-hdr-samples'] });
    expect(mergeDisplayHdrCapabilityReports([report({ state: 'no-display', sampleCount: 0,
      observedCount: 0, enabledCount: 0, latestHdr: null, confidence: 0 })])).toMatchObject({ state: 'no-display', recommendations: ['keep-display-controls-disabled'] });
    expect(mergeDisplayHdrCapabilityReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, enabledCount: 0, latestHdr: null, confidence: 0 })])).toMatchObject({ state: 'no-observation', recommendations: ['request-hdr-observation'] });
    expect(mergeDisplayHdrCapabilityReports([report({ state: 'incomplete-hdr-evidence', incompleteCount: 1 })])).toMatchObject({ state: 'incomplete-hdr-evidence', recommendations: ['request-complete-hdr-evidence'] });
    expect(mergeDisplayHdrCapabilityReports([report({ state: 'hdr-drift-observed', transitionCount: 1 })])).toMatchObject({ state: 'hdr-drift-observed', recommendations: ['observe-next-hdr-sample'] });
    expect(mergeDisplayHdrCapabilityReports([report({ state: 'hdr-enabled' })])).toMatchObject({ state: 'hdr-enabled', recommendations: ['preserve-observed-hdr-state'] });
    expect(mergeDisplayHdrCapabilityReports([report({ state: 'hdr-disabled', enabledCount: 0, disabledCount: 4, latestHdr: false })])).toMatchObject({ state: 'hdr-disabled', recommendations: ['preserve-observed-sdr-state'] });
    expect(mergeDisplayHdrCapabilityReports([report({ state: 'hdr-enabled' }), report({ state: 'hdr-disabled', enabledCount: 0, disabledCount: 4, latestHdr: false })])).toMatchObject({ state: 'hdr-observed', recommendations: ['no-change'] });
    expect(mergeDisplayHdrCapabilityReports([report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, enabledCount: 0, disabledCount: 0, comparisonCount: 0, latestHdr: null, confidence: 0 })]).state).toBe('insufficient-data');
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeDisplayHdrCapabilityReports([
      report({ state: 'hdr-drift-sustained', transitionCount: 2 }),
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0, enabledCount: 0, latestHdr: null, confidence: 0 })
    ])).toMatchObject({ state: 'no-observation' });
    const states = [
      ['hdr-drift-sustained', 'hdr-review', 750], ['hdr-drift-observed', 'hdr-observation', 1000],
      ['hdr-enabled', 'hdr-state-observation', 5000], ['hdr-disabled', 'hdr-state-observation', 5000],
      ['hdr-observed', 'hdr-state-observation', 5000], ['no-display', 'no-display-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000], ['incomplete-hdr-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const unavailable = state === 'no-display' || state === 'no-observation';
      const sampleCount = unavailable ? 0 : 4;
      expect(buildDisplayHdrCapabilityPlan(report({ state, sampleCount, observedCount: sampleCount,
        enabledCount: state === 'hdr-disabled' ? 0 : sampleCount, disabledCount: state === 'hdr-disabled' ? sampleCount : 0,
        latestHdr: unavailable ? null : state !== 'hdr-disabled' }), 'interactive')).toMatchObject({
        environment: 'interactive', mode, intervalMs, state, confidence: unavailable ? 0 : 1
      });
    }
    expect(buildDisplayHdrCapabilityPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildDisplayHdrCapabilityPlan(report({ sampleCount: 0, observedCount: 0, enabledCount: 0, latestHdr: null, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildDisplayHdrCapabilityEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: DISPLAY_HDR_CAPABILITY_LIBRARY_ID, libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createDisplayHdrCapabilityLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(DISPLAY_HDR_CAPABILITY_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0, enabledCount: 0, latestHdr: null, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, fields, triggers, and clocks', () => {
    expect(() => mergeDisplayHdrCapabilityReports(null)).toThrow('reports must be an array');
    expect(() => mergeDisplayHdrCapabilityReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeDisplayHdrCapabilityReports([null])).toThrow('report must be an object');
    expect(() => mergeDisplayHdrCapabilityReports([[]])).toThrow('report must be an object');
    expect(() => mergeDisplayHdrCapabilityReports([report({ turbo: 'other' })])).toThrow('requires an HDR-capability turbo report');
    expect(() => mergeDisplayHdrCapabilityReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeDisplayHdrCapabilityReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be non-negative');
    expect(() => mergeDisplayHdrCapabilityReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeDisplayHdrCapabilityReports([report({ changeThreshold: 0 })])).toThrow('changeThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'enabledCount', 'disabledCount', 'incompleteCount', 'noDisplayCount', 'noObservationCount', 'transitionCount', 'comparisonCount']) {
      expect(() => mergeDisplayHdrCapabilityReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergeDisplayHdrCapabilityReports([report({ latestHdr: 1 })])).toThrow('latestHdr must be boolean or null');
    expect(() => mergeDisplayHdrCapabilityReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildDisplayHdrCapabilityEnvelope(report())).toThrow('trigger is required');
    expect(() => buildDisplayHdrCapabilityEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildDisplayHdrCapabilityEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildDisplayHdrCapabilityEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
