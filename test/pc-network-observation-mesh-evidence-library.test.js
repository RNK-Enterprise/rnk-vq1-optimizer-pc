import {
  NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_ID,
  NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_VERSION,
  buildNetworkObservationMeshEvidenceEnvelope,
  buildNetworkObservationMeshEvidencePlan,
  createNetworkObservationMeshEvidenceLibrary,
  mergeNetworkObservationMeshEvidenceReports
} from '../pc/engines/network-observation/turbos/mesh-evidence/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'network-observation.mesh-evidence', state: 'stable-mesh-evidence', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, linkCount: 2,
    meshCount: 1, unknownMeshCount: 0, meshChangeCount: 0,
    observedCount: sampleCount, incompleteCount: 0, noNetworkCount: 0,
    comparisonCount: sampleCount - 1, meshChangeSampleCount: 0, confidence: 1, ...overrides
  };
}

describe('network-observation mesh-evidence library', () => {
  test('publishes identity and merges mesh evidence', () => {
    const merged = mergeNetworkObservationMeshEvidenceReports([
      report({ sampleCount: 2, linkCount: 1, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'mesh-drift-sustained', sampleCount: 6, observedCount: 5,
        meshCount: 1, meshChangeCount: 1, comparisonCount: 5,
        meshChangeSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_ID).toBe('network-observation.mesh-evidence.library');
    expect(NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'mesh-drift-sustained', sampleCount: 8,
      linkCount: 2, meshCount: 1, unknownMeshCount: 0, meshChangeCount: 1, observedCount: 7,
      comparisonCount: 6, meshChangeSampleCount: 3, confidence: 0.875,
      recommendations: ['review-mesh-evidence-drift-without-network-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeNetworkObservationMeshEvidenceReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-mesh-evidence']
    });
    expect(mergeNetworkObservationMeshEvidenceReports([report({ state: 'no-network', sampleCount: 1,
      linkCount: 0, meshCount: 0, unknownMeshCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-network', recommendations: ['no-network-mesh-review']
    });
    expect(mergeNetworkObservationMeshEvidenceReports([report({ state: 'incomplete-evidence',
      linkCount: 0, meshCount: 0, unknownMeshCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-explicit-mesh-evidence']
    });
    expect(mergeNetworkObservationMeshEvidenceReports([report({ state: 'mesh-drift-observed',
      meshChangeCount: 1, meshChangeSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['observe-mesh-evidence-stability']);
    expect(mergeNetworkObservationMeshEvidenceReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeNetworkObservationMeshEvidenceReports([report({ state: 'insufficient-data', sampleCount: 1,
      linkCount: 0, meshCount: 0, unknownMeshCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeNetworkObservationMeshEvidenceReports([report({ state: 'insufficient-data', sampleCount: 0,
      linkCount: 0, meshCount: 0, unknownMeshCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeNetworkObservationMeshEvidenceReports([
      report({ state: 'mesh-drift-sustained' }), report({ state: 'no-network', sampleCount: 1,
        linkCount: 0, meshCount: 0, unknownMeshCount: 0, observedCount: 0, noNetworkCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-network' });
    const states = [
      ['mesh-drift-sustained', 'mesh-evidence-review', 750],
      ['mesh-drift-observed', 'mesh-evidence-observation', 1000],
      ['stable-mesh-evidence', 'stable-mesh-observation', 5000],
      ['no-network', 'no-network-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-network';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildNetworkObservationMeshEvidencePlan(report({ state, sampleCount,
        linkCount: empty ? 0 : 2, meshCount: empty ? 0 : 1, unknownMeshCount: 0,
        observedCount: empty ? 0 : sampleCount, noNetworkCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildNetworkObservationMeshEvidencePlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildNetworkObservationMeshEvidencePlan(report({ sampleCount: 0, linkCount: 0,
      meshCount: 0, unknownMeshCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildNetworkObservationMeshEvidenceEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createNetworkObservationMeshEvidenceLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(NETWORK_OBSERVATION_MESH_EVIDENCE_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, linkCount: 0,
      meshCount: 0, unknownMeshCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeNetworkObservationMeshEvidenceReports(null)).toThrow('reports must be an array');
    expect(() => mergeNetworkObservationMeshEvidenceReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeNetworkObservationMeshEvidenceReports([null])).toThrow('report must be an object');
    expect(() => mergeNetworkObservationMeshEvidenceReports([report({ turbo: 'other' })]))
      .toThrow('requires a mesh-evidence turbo report');
    expect(() => mergeNetworkObservationMeshEvidenceReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeNetworkObservationMeshEvidenceReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeNetworkObservationMeshEvidenceReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeNetworkObservationMeshEvidenceReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noNetworkCount', 'comparisonCount', 'meshChangeSampleCount']) {
      expect(() => mergeNetworkObservationMeshEvidenceReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeNetworkObservationMeshEvidenceReports([report({ linkCount: 4097 })]))
      .toThrow('linkCount must be from 0 to 4096');
    expect(() => mergeNetworkObservationMeshEvidenceReports([report({ meshCount: 3 })]))
      .toThrow('meshCount must fit inside linkCount');
    expect(() => mergeNetworkObservationMeshEvidenceReports([report({ unknownMeshCount: 3 })]))
      .toThrow('unknownMeshCount must fit inside linkCount');
    expect(() => mergeNetworkObservationMeshEvidenceReports([report({ meshChangeCount: 8193 })]))
      .toThrow('meshChangeCount must be from 0 to 8192');
    expect(() => mergeNetworkObservationMeshEvidenceReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildNetworkObservationMeshEvidenceEnvelope(report())).toThrow('trigger is required');
    expect(() => buildNetworkObservationMeshEvidenceEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
