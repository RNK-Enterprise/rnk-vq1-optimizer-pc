import {
  NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_ID,
  NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_VERSION,
  buildNetworkSafetySafetyEvidenceEnvelope,
  buildNetworkSafetySafetyEvidencePlan,
  createNetworkSafetySafetyEvidenceLibrary,
  mergeNetworkSafetySafetyEvidenceReports
} from '../pc/engines/network-safety/turbos/safety-evidence/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'network-safety.safety-evidence', state: 'observed-safe-evidence', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, linkCount: 2,
    reviewCount: 0, unknownCount: 0, observedCount: 2, riskChangeCount: 0,
    observedSampleCount: sampleCount, incompleteCount: 0, noNetworkCount: 0,
    reviewSampleCount: 0, unknownSampleCount: 0, confidence: 1, ...overrides
  };
}

describe('network-safety safety-evidence library', () => {
  test('publishes identity and merges safety evidence', () => {
    const merged = mergeNetworkSafetySafetyEvidenceReports([
      report({ sampleCount: 2, linkCount: 2, observedSampleCount: 2 }),
      report({ state: 'review-risk-sustained', sampleCount: 6, observedSampleCount: 5,
        reviewCount: 1, reviewSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_ID).toBe('network-safety.safety-evidence.library');
    expect(NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'review-risk-sustained', sampleCount: 8,
      linkCount: 2, reviewCount: 1, unknownCount: 0, observedCount: 2,
      observedSampleCount: 7, reviewSampleCount: 3, confidence: 0.875,
      recommendations: ['review-network-safety-evidence-without-network-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeNetworkSafetySafetyEvidenceReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-safety-evidence']
    });
    expect(mergeNetworkSafetySafetyEvidenceReports([report({ state: 'no-network', sampleCount: 1,
      linkCount: 0, reviewCount: 0, unknownCount: 0, observedCount: 0, observedSampleCount: 0,
      noNetworkCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-network', recommendations: ['no-network-safety-review']
    });
    expect(mergeNetworkSafetySafetyEvidenceReports([report({ state: 'incomplete-evidence',
      linkCount: 0, reviewCount: 0, unknownCount: 0, observedCount: 0, observedSampleCount: 0,
      incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-network-environment-profile']
    });
    expect(mergeNetworkSafetySafetyEvidenceReports([report({ state: 'review-risk-observed',
      reviewCount: 1, reviewSampleCount: 1 })]).recommendations)
      .toEqual(['observe-network-safety-review-state']);
    expect(mergeNetworkSafetySafetyEvidenceReports([report({ state: 'unknown-risk-evidence',
      unknownCount: 1, unknownSampleCount: 1 })]).recommendations)
      .toEqual(['request-network-safety-observation']);
    expect(mergeNetworkSafetySafetyEvidenceReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeNetworkSafetySafetyEvidenceReports([report({ state: 'insufficient-data', sampleCount: 1,
      linkCount: 0, reviewCount: 0, unknownCount: 0, observedCount: 0, observedSampleCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeNetworkSafetySafetyEvidenceReports([report({ state: 'insufficient-data', sampleCount: 0,
      linkCount: 0, reviewCount: 0, unknownCount: 0, observedCount: 0, observedSampleCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeNetworkSafetySafetyEvidenceReports([
      report({ state: 'review-risk-sustained' }), report({ state: 'no-network', sampleCount: 1,
        linkCount: 0, reviewCount: 0, unknownCount: 0, observedCount: 0, observedSampleCount: 0,
        noNetworkCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-network' });
    const states = [
      ['review-risk-sustained', 'safety-review', 750],
      ['review-risk-observed', 'safety-observation', 1000],
      ['unknown-risk-evidence', 'evidence-bootstrap', 1500],
      ['observed-safe-evidence', 'observed-safety-monitoring', 5000],
      ['no-network', 'no-network-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-network';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildNetworkSafetySafetyEvidencePlan(report({ state, sampleCount,
        linkCount: empty ? 0 : 2, reviewCount: 0, unknownCount: state === 'unknown-risk-evidence' ? 1 : 0,
        observedCount: empty ? 0 : 2, observedSampleCount: empty ? 0 : sampleCount,
        noNetworkCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildNetworkSafetySafetyEvidencePlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildNetworkSafetySafetyEvidencePlan(report({ sampleCount: 0, linkCount: 0,
      reviewCount: 0, unknownCount: 0, observedCount: 0, observedSampleCount: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildNetworkSafetySafetyEvidenceEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createNetworkSafetySafetyEvidenceLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, linkCount: 0,
      reviewCount: 0, unknownCount: 0, observedCount: 0, observedSampleCount: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeNetworkSafetySafetyEvidenceReports(null)).toThrow('reports must be an array');
    expect(() => mergeNetworkSafetySafetyEvidenceReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeNetworkSafetySafetyEvidenceReports([null])).toThrow('report must be an object');
    expect(() => mergeNetworkSafetySafetyEvidenceReports([report({ turbo: 'other' })]))
      .toThrow('requires a safety-evidence turbo report');
    expect(() => mergeNetworkSafetySafetyEvidenceReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeNetworkSafetySafetyEvidenceReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeNetworkSafetySafetyEvidenceReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeNetworkSafetySafetyEvidenceReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedSampleCount', 'incompleteCount', 'noNetworkCount', 'reviewSampleCount', 'unknownSampleCount']) {
      expect(() => mergeNetworkSafetySafetyEvidenceReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const field of ['reviewCount', 'unknownCount', 'observedCount']) {
      expect(() => mergeNetworkSafetySafetyEvidenceReports([report({ [field]: 3 })]))
        .toThrow('must fit inside linkCount');
    }
    expect(() => mergeNetworkSafetySafetyEvidenceReports([report({ linkCount: 4097 })]))
      .toThrow('linkCount must be from 0 to 4096');
    expect(() => mergeNetworkSafetySafetyEvidenceReports([report({ riskChangeCount: 4097 })]))
      .toThrow('riskChangeCount must be from 0 to 4096');
    expect(() => mergeNetworkSafetySafetyEvidenceReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildNetworkSafetySafetyEvidenceEnvelope(report())).toThrow('trigger is required');
    expect(() => buildNetworkSafetySafetyEvidenceEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
