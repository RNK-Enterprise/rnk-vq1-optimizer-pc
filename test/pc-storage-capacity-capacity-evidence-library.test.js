import {
  STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_ID,
  STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_VERSION,
  buildStorageCapacityCapacityEvidenceEnvelope,
  buildStorageCapacityCapacityEvidencePlan,
  createStorageCapacityCapacityEvidenceLibrary,
  mergeStorageCapacityCapacityEvidenceReports
} from '../pc/engines/storage-capacity/turbos/capacity-evidence/library.js';

function report(overrides = {}) { const sampleCount = overrides.sampleCount ?? 4; return {
  turbo: 'storage-capacity.capacity-evidence', state: 'complete-capacity-evidence', sampleCount, minimumSamples: 2,
  evidenceThreshold: 0.75, persistenceThreshold: 2, storageCount: 2, completeCount: 2, incompleteRowCount: 0,
  evidenceRatio: 1, observedCount: sampleCount, incompleteCount: 0, noStorageCount: 0, gapSampleCount: 0, confidence: 1, ...overrides
}; }

describe('storage-capacity capacity-evidence library', () => {
  test('publishes identity and merges evidence gaps', () => {
    const merged = mergeStorageCapacityCapacityEvidenceReports([
      report({ sampleCount: 2, completeCount: 1, incompleteRowCount: 1, evidenceRatio: 0.5, gapSampleCount: 1 }),
      report({ state: 'capacity-evidence-gap-sustained', sampleCount: 6, observedCount: 5, completeCount: 1, incompleteRowCount: 1, evidenceRatio: 0.5, gapSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_ID).toBe('storage-capacity.capacity-evidence.library');
    expect(STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'capacity-evidence-gap-sustained', sampleCount: 8, completeCount: 1, incompleteRowCount: 1, evidenceRatio: 0.5, gapSampleCount: 4, confidence: 0.875, recommendations: ['request-complete-capacity-facts'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('preserves aggregate states and empty confidence', () => {
    expect(mergeStorageCapacityCapacityEvidenceReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeStorageCapacityCapacityEvidenceReports([report({ state: 'no-storage', sampleCount: 1, storageCount: 0, completeCount: 0, incompleteRowCount: 0, evidenceRatio: null, observedCount: 0, noStorageCount: 1, confidence: 0 })])).toMatchObject({ state: 'no-storage', recommendations: ['no-storage-evidence-review'] });
    expect(mergeStorageCapacityCapacityEvidenceReports([report({ state: 'incomplete-capacity-evidence', completeCount: 0, incompleteRowCount: 2, evidenceRatio: null, incompleteCount: 1, confidence: 0 })])).toMatchObject({ state: 'incomplete-capacity-evidence', recommendations: ['request-environment-profile'] });
    expect(mergeStorageCapacityCapacityEvidenceReports([report({ state: 'capacity-evidence-gap-observed', completeCount: 1, incompleteRowCount: 1, evidenceRatio: 0.5, gapSampleCount: 1 })]).recommendations).toEqual(['observe-capacity-fact-completeness']);
    expect(mergeStorageCapacityCapacityEvidenceReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeStorageCapacityCapacityEvidenceReports([report({ state: 'insufficient-data', sampleCount: 1, storageCount: 0, completeCount: 0, incompleteRowCount: 0, evidenceRatio: null, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeStorageCapacityCapacityEvidenceReports([report({ state: 'insufficient-data', sampleCount: 0, storageCount: 0, completeCount: 0, incompleteRowCount: 0, evidenceRatio: null, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });
  test('applies safety precedence and builds every state plan', () => {
    expect(mergeStorageCapacityCapacityEvidenceReports([report({ state: 'capacity-evidence-gap-sustained' }), report({ state: 'no-storage', sampleCount: 1, storageCount: 0, completeCount: 0, incompleteRowCount: 0, evidenceRatio: null, observedCount: 0, noStorageCount: 1, confidence: 0 })])).toMatchObject({ state: 'no-storage' });
    const states = [['capacity-evidence-gap-sustained', 'capacity-fact-review', 750], ['capacity-evidence-gap-observed', 'capacity-fact-observation', 1000], ['complete-capacity-evidence', 'complete-capacity-observation', 5000], ['no-storage', 'no-storage-observation', 10000], ['incomplete-capacity-evidence', 'evidence-bootstrap', 1500], ['insufficient-data', 'sample-bootstrap', 1500]];
    for (const [state, mode, intervalMs] of states) { const empty = state === 'no-storage'; const sampleCount = empty ? 1 : 4; const confidence = empty ? 0 : 1; expect(buildStorageCapacityCapacityEvidencePlan(report({ state, sampleCount, storageCount: empty ? 0 : 2, completeCount: empty ? 0 : 2, incompleteRowCount: 0, evidenceRatio: empty ? null : 1, observedCount: empty ? 0 : sampleCount, noStorageCount: empty ? 1 : 0, confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence }); }
    expect(buildStorageCapacityCapacityEvidencePlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildStorageCapacityCapacityEvidencePlan(report({ sampleCount: 0, storageCount: 0, completeCount: 0, incompleteRowCount: 0, evidenceRatio: null, observedCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds immutable envelopes and factories', () => {
    const envelope = buildStorageCapacityCapacityEvidenceEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_ID, libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true); const library = createStorageCapacityCapacityEvidenceLibrary();
    expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, storageCount: 0, completeCount: 0, incompleteRowCount: 0, evidenceRatio: null, observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports, bounds, ratios, triggers, and clocks', () => {
    expect(() => mergeStorageCapacityCapacityEvidenceReports(null)).toThrow('reports must be an array');
    expect(() => mergeStorageCapacityCapacityEvidenceReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeStorageCapacityCapacityEvidenceReports([null])).toThrow('report must be an object');
    expect(() => mergeStorageCapacityCapacityEvidenceReports([report({ turbo: 'other' })])).toThrow('requires a capacity-evidence turbo report');
    expect(() => mergeStorageCapacityCapacityEvidenceReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeStorageCapacityCapacityEvidenceReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeStorageCapacityCapacityEvidenceReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeStorageCapacityCapacityEvidenceReports([report({ evidenceThreshold: 1.1 })])).toThrow('evidenceThreshold must be between 0 and 1');
    expect(() => mergeStorageCapacityCapacityEvidenceReports([report({ persistenceThreshold: 0 })])).toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noStorageCount', 'gapSampleCount']) expect(() => mergeStorageCapacityCapacityEvidenceReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    expect(() => mergeStorageCapacityCapacityEvidenceReports([report({ storageCount: 4097 })])).toThrow('storageCount must be from 0 to 4096');
    expect(() => mergeStorageCapacityCapacityEvidenceReports([report({ completeCount: 3 })])).toThrow('complete count must fit inside storageCount');
    expect(() => mergeStorageCapacityCapacityEvidenceReports([report({ incompleteRowCount: 3 })])).toThrow('incomplete row count must fit inside storageCount');
    expect(() => mergeStorageCapacityCapacityEvidenceReports([report({ evidenceRatio: 1.1 })])).toThrow('evidenceRatio must be null or between 0 and 1');
    expect(() => mergeStorageCapacityCapacityEvidenceReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildStorageCapacityCapacityEvidenceEnvelope(report())).toThrow('trigger is required');
    expect(() => buildStorageCapacityCapacityEvidenceEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
