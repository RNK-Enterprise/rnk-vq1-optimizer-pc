import {
  NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_ID,
  NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_VERSION,
  buildNetworkSafetyEncryptionDriftEnvelope,
  buildNetworkSafetyEncryptionDriftPlan,
  createNetworkSafetyEncryptionDriftLibrary,
  mergeNetworkSafetyEncryptionDriftReports
} from '../pc/engines/network-safety/turbos/encryption-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'network-safety.encryption-drift', state: 'stable-encryption', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, linkCount: 2,
    encryptedCount: 2, unknownEncryptionCount: 0, encryptionChangeCount: 0,
    observedCount: sampleCount, incompleteCount: 0, noNetworkCount: 0,
    comparisonCount: sampleCount - 1, encryptionChangeSampleCount: 0,
    confidence: 1, ...overrides
  };
}

describe('network-safety encryption-drift library', () => {
  test('publishes identity and merges encryption evidence', () => {
    const merged = mergeNetworkSafetyEncryptionDriftReports([
      report({ sampleCount: 2, linkCount: 1, encryptedCount: 1, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'encryption-drift-sustained', sampleCount: 6, observedCount: 5,
        encryptedCount: 1, encryptionChangeCount: 1, comparisonCount: 5,
        encryptionChangeSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_ID).toBe('network-safety.encryption-drift.library');
    expect(NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'encryption-drift-sustained', sampleCount: 8,
      linkCount: 2, encryptedCount: 1, unknownEncryptionCount: 0, encryptionChangeCount: 1,
      observedCount: 7, comparisonCount: 6, encryptionChangeSampleCount: 3, confidence: 0.875,
      recommendations: ['review-encryption-drift-without-network-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeNetworkSafetyEncryptionDriftReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-encryption-evidence']
    });
    expect(mergeNetworkSafetyEncryptionDriftReports([report({ state: 'no-network', sampleCount: 1,
      linkCount: 0, encryptedCount: 0, unknownEncryptionCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-network', recommendations: ['no-network-encryption-review']
    });
    expect(mergeNetworkSafetyEncryptionDriftReports([report({ state: 'incomplete-evidence',
      linkCount: 0, encryptedCount: 0, unknownEncryptionCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-explicit-encryption-evidence']
    });
    expect(mergeNetworkSafetyEncryptionDriftReports([report({ state: 'encryption-drift-observed',
      encryptionChangeCount: 1, encryptionChangeSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['observe-encryption-stability']);
    expect(mergeNetworkSafetyEncryptionDriftReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeNetworkSafetyEncryptionDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      linkCount: 0, encryptedCount: 0, unknownEncryptionCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeNetworkSafetyEncryptionDriftReports([report({ state: 'insufficient-data', sampleCount: 0,
      linkCount: 0, encryptedCount: 0, unknownEncryptionCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeNetworkSafetyEncryptionDriftReports([
      report({ state: 'encryption-drift-sustained' }), report({ state: 'no-network', sampleCount: 1,
        linkCount: 0, encryptedCount: 0, unknownEncryptionCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-network' });
    const states = [
      ['encryption-drift-sustained', 'encryption-review', 750],
      ['encryption-drift-observed', 'encryption-observation', 1000],
      ['stable-encryption', 'stable-encryption-observation', 5000],
      ['no-network', 'no-network-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-network';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildNetworkSafetyEncryptionDriftPlan(report({ state, sampleCount,
        linkCount: empty ? 0 : 2, encryptedCount: empty ? 0 : 2, unknownEncryptionCount: 0,
        observedCount: empty ? 0 : sampleCount, noNetworkCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildNetworkSafetyEncryptionDriftPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildNetworkSafetyEncryptionDriftPlan(report({ sampleCount: 0, linkCount: 0,
      encryptedCount: 0, unknownEncryptionCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildNetworkSafetyEncryptionDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createNetworkSafetyEncryptionDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, linkCount: 0,
      encryptedCount: 0, unknownEncryptionCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeNetworkSafetyEncryptionDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeNetworkSafetyEncryptionDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeNetworkSafetyEncryptionDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeNetworkSafetyEncryptionDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires an encryption-drift turbo report');
    expect(() => mergeNetworkSafetyEncryptionDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeNetworkSafetyEncryptionDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeNetworkSafetyEncryptionDriftReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeNetworkSafetyEncryptionDriftReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noNetworkCount', 'comparisonCount', 'encryptionChangeSampleCount']) {
      expect(() => mergeNetworkSafetyEncryptionDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const field of ['encryptedCount', 'unknownEncryptionCount']) {
      expect(() => mergeNetworkSafetyEncryptionDriftReports([report({ [field]: 3 })]))
        .toThrow('must fit inside linkCount');
    }
    expect(() => mergeNetworkSafetyEncryptionDriftReports([report({ linkCount: 4097 })]))
      .toThrow('linkCount must be from 0 to 4096');
    expect(() => mergeNetworkSafetyEncryptionDriftReports([report({ encryptionChangeCount: 4097 })]))
      .toThrow('encryptionChangeCount must be from 0 to 4096');
    expect(() => mergeNetworkSafetyEncryptionDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildNetworkSafetyEncryptionDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildNetworkSafetyEncryptionDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
