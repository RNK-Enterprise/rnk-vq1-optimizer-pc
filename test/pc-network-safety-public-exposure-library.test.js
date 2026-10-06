import {
  NETWORK_SAFETY_PUBLIC_EXPOSURE_LIBRARY_ID,
  NETWORK_SAFETY_PUBLIC_EXPOSURE_LIBRARY_VERSION,
  buildNetworkSafetyPublicExposureEnvelope,
  buildNetworkSafetyPublicExposurePlan,
  createNetworkSafetyPublicExposureLibrary,
  mergeNetworkSafetyPublicExposureReports
} from '../pc/engines/network-safety/turbos/public-exposure/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'network-safety.public-exposure', state: 'no-public-exposure', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, linkCount: 2,
    exposureCount: 0, unknownEvidenceCount: 0, observedCount: sampleCount,
    incompleteCount: 0, noNetworkCount: 0, exposureSampleCount: 0,
    confidence: 1, ...overrides
  };
}

describe('network-safety public-exposure library', () => {
  test('publishes identity and merges exposure evidence', () => {
    const merged = mergeNetworkSafetyPublicExposureReports([
      report({ sampleCount: 2, linkCount: 1, observedCount: 2 }),
      report({ state: 'public-exposure-sustained', sampleCount: 6, observedCount: 5,
        exposureCount: 1, exposureSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(NETWORK_SAFETY_PUBLIC_EXPOSURE_LIBRARY_ID).toBe('network-safety.public-exposure.library');
    expect(NETWORK_SAFETY_PUBLIC_EXPOSURE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'public-exposure-sustained', sampleCount: 8,
      linkCount: 2, exposureCount: 1, unknownEvidenceCount: 0, observedCount: 7,
      exposureSampleCount: 3, confidence: 0.875,
      recommendations: ['review-public-unencrypted-evidence-without-network-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeNetworkSafetyPublicExposureReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-public-exposure-evidence']
    });
    expect(mergeNetworkSafetyPublicExposureReports([report({ state: 'no-network', sampleCount: 1,
      linkCount: 0, exposureCount: 0, unknownEvidenceCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-network', recommendations: ['no-network-exposure-review']
    });
    expect(mergeNetworkSafetyPublicExposureReports([report({ state: 'incomplete-evidence',
      linkCount: 0, exposureCount: 0, unknownEvidenceCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-public-and-encryption-evidence']
    });
    expect(mergeNetworkSafetyPublicExposureReports([report({ state: 'public-exposure-observed',
      exposureCount: 1, exposureSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['observe-public-exposure-stability']);
    expect(mergeNetworkSafetyPublicExposureReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeNetworkSafetyPublicExposureReports([report({ state: 'insufficient-data', sampleCount: 1,
      linkCount: 0, exposureCount: 0, unknownEvidenceCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeNetworkSafetyPublicExposureReports([report({ state: 'insufficient-data', sampleCount: 0,
      linkCount: 0, exposureCount: 0, unknownEvidenceCount: 0, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeNetworkSafetyPublicExposureReports([
      report({ state: 'public-exposure-sustained' }), report({ state: 'no-network', sampleCount: 1,
        linkCount: 0, exposureCount: 0, unknownEvidenceCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-network' });
    const states = [
      ['public-exposure-sustained', 'public-exposure-review', 750],
      ['public-exposure-observed', 'public-exposure-observation', 1000],
      ['no-public-exposure', 'no-public-exposure-observation', 5000],
      ['no-network', 'no-network-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-network';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildNetworkSafetyPublicExposurePlan(report({ state, sampleCount,
        linkCount: empty ? 0 : 2, exposureCount: 0, unknownEvidenceCount: 0,
        observedCount: empty ? 0 : sampleCount, noNetworkCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildNetworkSafetyPublicExposurePlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildNetworkSafetyPublicExposurePlan(report({ sampleCount: 0, linkCount: 0,
      exposureCount: 0, unknownEvidenceCount: 0, observedCount: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildNetworkSafetyPublicExposureEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: NETWORK_SAFETY_PUBLIC_EXPOSURE_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createNetworkSafetyPublicExposureLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(NETWORK_SAFETY_PUBLIC_EXPOSURE_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, linkCount: 0,
      exposureCount: 0, unknownEvidenceCount: 0, observedCount: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeNetworkSafetyPublicExposureReports(null)).toThrow('reports must be an array');
    expect(() => mergeNetworkSafetyPublicExposureReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeNetworkSafetyPublicExposureReports([null])).toThrow('report must be an object');
    expect(() => mergeNetworkSafetyPublicExposureReports([report({ turbo: 'other' })]))
      .toThrow('requires a public-exposure turbo report');
    expect(() => mergeNetworkSafetyPublicExposureReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeNetworkSafetyPublicExposureReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeNetworkSafetyPublicExposureReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeNetworkSafetyPublicExposureReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noNetworkCount', 'exposureSampleCount']) {
      expect(() => mergeNetworkSafetyPublicExposureReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeNetworkSafetyPublicExposureReports([report({ linkCount: 4097 })]))
      .toThrow('linkCount must be from 0 to 4096');
    expect(() => mergeNetworkSafetyPublicExposureReports([report({ exposureCount: 3 })]))
      .toThrow('exposureCount must fit inside linkCount');
    expect(() => mergeNetworkSafetyPublicExposureReports([report({ unknownEvidenceCount: 3 })]))
      .toThrow('unknownEvidenceCount must fit inside linkCount');
    expect(() => mergeNetworkSafetyPublicExposureReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildNetworkSafetyPublicExposureEnvelope(report())).toThrow('trigger is required');
    expect(() => buildNetworkSafetyPublicExposureEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
