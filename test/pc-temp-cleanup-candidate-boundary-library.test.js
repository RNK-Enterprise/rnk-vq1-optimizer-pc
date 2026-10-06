import { TEMP_CANDIDATE_BOUNDARY_LIBRARY_ID, TEMP_CANDIDATE_BOUNDARY_LIBRARY_VERSION,
  buildTempCandidateBoundaryEnvelope, buildTempCandidateBoundaryPlan, createTempCandidateBoundaryLibrary,
  mergeTempCandidateBoundaryReports } from '../pc/engines/temp-cleanup/turbos/candidate-boundary/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'temp-cleanup.candidate-boundary', state: 'preview-stable', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    fileCount: 1, candidateCount: 1, reviewCount: 0, completeCount: 1, candidateBytes: 10, comparisonCount: Math.max(0, sampleCount - 1), changeCount: 0,
    finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('temp-cleanup candidate-boundary library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeTempCandidateBoundaryReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'candidate-drift-sustained', changeCount: 2, candidateBytes: 30, finalEnvironment: 'headless' })]);
    expect(TEMP_CANDIDATE_BOUNDARY_LIBRARY_ID).toBe('temp-cleanup.candidate-boundary.library'); expect(TEMP_CANDIDATE_BOUNDARY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'candidate-drift-sustained', sampleCount: 6, fileCount: 1, candidateCount: 1, comparisonCount: 4, changeCount: 2, candidateBytes: 30, finalEnvironment: 'headless', recommendations: ['review-candidate-drift-without-file-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeTempCandidateBoundaryReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-temp-candidate-samples'] });
    expect(mergeTempCandidateBoundaryReports([report({ state: 'no-temp-review', fileCount: 0, candidateCount: 0, comparisonCount: 0, candidateBytes: 0, confidence: 0.25 })]).recommendations).toEqual(['no-temp-cleanup-review']);
    expect(mergeTempCandidateBoundaryReports([report({ state: 'review-required', reviewCount: 1 })]).recommendations).toEqual(['review-temp-file-ownership']);
    expect(mergeTempCandidateBoundaryReports([report({ state: 'candidate-drift-observed', changeCount: 1 })]).recommendations).toEqual(['observe-temp-candidate-stability']);
    expect(mergeTempCandidateBoundaryReports([report()]).recommendations).toEqual(['preview-safe-temp-candidates']);
    expect(mergeTempCandidateBoundaryReports([report({ state: 'insufficient-data', sampleCount: 1, fileCount: 0, candidateCount: 0, comparisonCount: 0, candidateBytes: 0, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs, sampleCount, fileCount, confidence] of [['no-temp-review', 'empty-observation', 10000, 4, 0, 0.25], ['review-required', 'ownership-review', 750, 4, 1, 1], ['candidate-drift-sustained', 'candidate-review', 1000, 4, 1, 1], ['candidate-drift-observed', 'candidate-observation', 1500, 4, 1, 1], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0, 0], ['preview-stable', 'preview-observation', 5000, 4, 1, 1]]) {
      expect(buildTempCandidateBoundaryPlan(report({ state, sampleCount, fileCount, candidateCount: fileCount, reviewCount: state === 'review-required' ? 1 : 0, comparisonCount: Math.max(0, sampleCount - 1), confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildTempCandidateBoundaryPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildTempCandidateBoundaryPlan(report({ sampleCount: 0, fileCount: 0, candidateCount: 0, comparisonCount: 0, candidateBytes: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildTempCandidateBoundaryEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createTempCandidateBoundaryLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(TEMP_CANDIDATE_BOUNDARY_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeTempCandidateBoundaryReports(null)).toThrow('reports must be an array');
    expect(() => mergeTempCandidateBoundaryReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeTempCandidateBoundaryReports([null])).toThrow('report must be an object');
    expect(() => mergeTempCandidateBoundaryReports([report({ turbo: 'other' })])).toThrow('requires a candidate-boundary turbo report');
    expect(() => mergeTempCandidateBoundaryReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeTempCandidateBoundaryReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeTempCandidateBoundaryReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeTempCandidateBoundaryReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeTempCandidateBoundaryReports([report({ fileCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeTempCandidateBoundaryReports([report({ candidateBytes: -1 })])).toThrow('candidateBytes must be non-negative');
    expect(() => mergeTempCandidateBoundaryReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeTempCandidateBoundaryReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildTempCandidateBoundaryEnvelope(report())).toThrow('trigger is required');
    expect(() => buildTempCandidateBoundaryEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
