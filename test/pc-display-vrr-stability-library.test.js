import {
  DISPLAY_VRR_STABILITY_LIBRARY_ID,
  DISPLAY_VRR_STABILITY_LIBRARY_VERSION,
  buildDisplayVrrStabilityEnvelope,
  buildDisplayVrrStabilityPlan,
  createDisplayVrrStabilityLibrary,
  mergeDisplayVrrStabilityReports
} from '../pc/engines/display-pipeline/turbos/vrr-stability/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'display-pipeline.vrr-stability',
    state: 'vrr-stable-enabled',
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
    latestVrr: sampleCount === 0 ? null : true,
    confidence: sampleCount === 0 ? 0 : 1,
    ...overrides
  };
}

describe('display-pipeline vrr-stability library', () => {
  test('publishes identity and merges VRR evidence', () => {
    const merged = mergeDisplayVrrStabilityReports([
      report({ sampleCount: 2, observedCount: 2, enabledCount: 1, disabledCount: 1,
        transitionCount: 1, comparisonCount: 1, latestVrr: false }),
      report({ state: 'vrr-drift-sustained', sampleCount: 6, observedCount: 5,
        enabledCount: 3, disabledCount: 2, transitionCount: 3, comparisonCount: 5,
        latestVrr: true, confidence: 0.8333 })
    ]);
    expect(DISPLAY_VRR_STABILITY_LIBRARY_ID).toBe('display-pipeline.vrr-stability.library');
    expect(DISPLAY_VRR_STABILITY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'vrr-drift-sustained', sampleCount: 8,
      observedCount: 7, enabledCount: 4, disabledCount: 3, transitionCount: 4, comparisonCount: 6,
      latestVrr: true, confidence: 0.875, recommendations: ['review-vrr-stability', 'hold-unapproved-display-policy'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeDisplayVrrStabilityReports([])).toMatchObject({ state: 'insufficient-data', reportCount: 0,
      confidence: 0, latestVrr: null, recommendations: ['collect-more-vrr-samples'] });
    expect(mergeDisplayVrrStabilityReports([report({ state: 'no-display', sampleCount: 0,
      observedCount: 0, enabledCount: 0, latestVrr: null, confidence: 0 })])).toMatchObject({ state: 'no-display', recommendations: ['keep-display-controls-disabled'] });
    expect(mergeDisplayVrrStabilityReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, enabledCount: 0, latestVrr: null, confidence: 0 })])).toMatchObject({ state: 'no-observation', recommendations: ['request-vrr-observation'] });
    expect(mergeDisplayVrrStabilityReports([report({ state: 'incomplete-vrr-evidence', incompleteCount: 1 })])).toMatchObject({ state: 'incomplete-vrr-evidence', recommendations: ['request-complete-vrr-evidence'] });
    expect(mergeDisplayVrrStabilityReports([report({ state: 'vrr-drift-observed', transitionCount: 1 })])).toMatchObject({ state: 'vrr-drift-observed', recommendations: ['observe-next-vrr-sample'] });
    expect(mergeDisplayVrrStabilityReports([report({ state: 'vrr-stable-enabled' })])).toMatchObject({ state: 'vrr-stable-enabled', recommendations: ['preserve-observed-vrr-state'] });
    expect(mergeDisplayVrrStabilityReports([report({ state: 'vrr-stable-disabled', enabledCount: 0, disabledCount: 4, latestVrr: false })])).toMatchObject({ state: 'vrr-stable-disabled', recommendations: ['preserve-observed-fixed-refresh-state'] });
    expect(mergeDisplayVrrStabilityReports([report({ state: 'vrr-stable-enabled' }), report({ state: 'vrr-stable-disabled', enabledCount: 0, disabledCount: 4, latestVrr: false })])).toMatchObject({ state: 'vrr-observed', recommendations: ['no-change'] });
    expect(mergeDisplayVrrStabilityReports([report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, enabledCount: 0, disabledCount: 0, comparisonCount: 0, latestVrr: null, confidence: 0 })]).state).toBe('insufficient-data');
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeDisplayVrrStabilityReports([
      report({ state: 'vrr-drift-sustained', transitionCount: 2 }),
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0, enabledCount: 0, latestVrr: null, confidence: 0 })
    ])).toMatchObject({ state: 'no-observation' });
    const states = [
      ['vrr-drift-sustained', 'vrr-review', 750], ['vrr-drift-observed', 'vrr-observation', 1000],
      ['vrr-stable-enabled', 'vrr-state-observation', 5000], ['vrr-stable-disabled', 'vrr-state-observation', 5000],
      ['vrr-observed', 'vrr-state-observation', 5000], ['no-display', 'no-display-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000], ['incomplete-vrr-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const unavailable = state === 'no-display' || state === 'no-observation';
      const sampleCount = unavailable ? 0 : 4;
      const disabled = state === 'vrr-stable-disabled';
      expect(buildDisplayVrrStabilityPlan(report({ state, sampleCount, observedCount: sampleCount,
        enabledCount: disabled ? 0 : sampleCount, disabledCount: disabled ? sampleCount : 0,
        latestVrr: unavailable ? null : !disabled }), 'interactive')).toMatchObject({
        environment: 'interactive', mode, intervalMs, state, confidence: unavailable ? 0 : 1
      });
    }
    expect(buildDisplayVrrStabilityPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildDisplayVrrStabilityPlan(report({ sampleCount: 0, observedCount: 0, enabledCount: 0, latestVrr: null, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildDisplayVrrStabilityEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: DISPLAY_VRR_STABILITY_LIBRARY_ID, libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createDisplayVrrStabilityLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(DISPLAY_VRR_STABILITY_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0, enabledCount: 0, latestVrr: null, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, fields, triggers, and clocks', () => {
    expect(() => mergeDisplayVrrStabilityReports(null)).toThrow('reports must be an array');
    expect(() => mergeDisplayVrrStabilityReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeDisplayVrrStabilityReports([null])).toThrow('report must be an object');
    expect(() => mergeDisplayVrrStabilityReports([[]])).toThrow('report must be an object');
    expect(() => mergeDisplayVrrStabilityReports([report({ turbo: 'other' })])).toThrow('requires a VRR-stability turbo report');
    expect(() => mergeDisplayVrrStabilityReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeDisplayVrrStabilityReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be non-negative');
    expect(() => mergeDisplayVrrStabilityReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeDisplayVrrStabilityReports([report({ changeThreshold: 0 })])).toThrow('changeThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'enabledCount', 'disabledCount', 'incompleteCount', 'noDisplayCount', 'noObservationCount', 'transitionCount', 'comparisonCount']) {
      expect(() => mergeDisplayVrrStabilityReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergeDisplayVrrStabilityReports([report({ latestVrr: 1 })])).toThrow('latestVrr must be boolean or null');
    expect(() => mergeDisplayVrrStabilityReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildDisplayVrrStabilityEnvelope(report())).toThrow('trigger is required');
    expect(() => buildDisplayVrrStabilityEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildDisplayVrrStabilityEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildDisplayVrrStabilityEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
