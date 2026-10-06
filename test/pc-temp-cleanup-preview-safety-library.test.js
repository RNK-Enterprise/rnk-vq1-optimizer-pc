import { TEMP_PREVIEW_SAFETY_LIBRARY_ID, TEMP_PREVIEW_SAFETY_LIBRARY_VERSION,
  buildTempPreviewSafetyEnvelope, buildTempPreviewSafetyPlan, createTempPreviewSafetyLibrary,
  mergeTempPreviewSafetyReports } from '../pc/engines/temp-cleanup/turbos/preview-safety/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'temp-cleanup.preview-safety', state: 'preview-safe-stable', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    fileCount: 1, safeCount: 1, reviewCount: 0, userOwnedCount: 0, incompleteCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changeCount: 0,
    candidateBytes: 10, finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('temp-cleanup preview-safety library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeTempPreviewSafetyReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'preview-drift-sustained', changeCount: 2, candidateBytes: 30, finalEnvironment: 'headless' })]);
    expect(TEMP_PREVIEW_SAFETY_LIBRARY_ID).toBe('temp-cleanup.preview-safety.library'); expect(TEMP_PREVIEW_SAFETY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'preview-drift-sustained', sampleCount: 6, fileCount: 1, safeCount: 1, comparisonCount: 4, changeCount: 2, candidateBytes: 30, finalEnvironment: 'headless', recommendations: ['review-temp-preview-drift-without-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeTempPreviewSafetyReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-temp-preview-evidence'] });
    expect(mergeTempPreviewSafetyReports([report({ state: 'no-temp-review', fileCount: 0, safeCount: 0, comparisonCount: 0, candidateBytes: 0, confidence: 0.25 })]).recommendations).toEqual(['no-temp-cleanup-review']);
    expect(mergeTempPreviewSafetyReports([report({ state: 'user-owned-review', userOwnedCount: 1, reviewCount: 1 })]).recommendations).toEqual(['preserve-user-owned-temp-boundary']);
    expect(mergeTempPreviewSafetyReports([report({ state: 'safety-evidence-required', reviewCount: 1, incompleteCount: 1 })]).recommendations).toEqual(['complete-temp-preview-evidence']);
    expect(mergeTempPreviewSafetyReports([report({ state: 'preview-drift-observed', changeCount: 1 })]).recommendations).toEqual(['observe-temp-preview-stability']);
    expect(mergeTempPreviewSafetyReports([report()])).toMatchObject({ state: 'preview-safe-stable', recommendations: ['preview-safe-temp-candidates'] });
    expect(mergeTempPreviewSafetyReports([report({ state: 'insufficient-data', sampleCount: 1, fileCount: 0, safeCount: 0, comparisonCount: 0, candidateBytes: 0, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs, sampleCount, fileCount, confidence] of [['no-temp-review', 'empty-observation', 10000, 4, 0, 0.25], ['user-owned-review', 'user-owned-review', 750, 4, 1, 0.5], ['safety-evidence-required', 'evidence-review', 1000, 4, 1, 0.5], ['preview-drift-sustained', 'preview-drift-review', 1250, 4, 1, 1], ['preview-drift-observed', 'preview-drift-observation', 1500, 4, 1, 1], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0, 0], ['preview-safe-stable', 'stable-observation', 5000, 4, 1, 1]]) {
      expect(buildTempPreviewSafetyPlan(report({ state, sampleCount, fileCount, safeCount: fileCount, reviewCount: state === 'preview-safe-stable' ? 0 : 1, userOwnedCount: state === 'user-owned-review' ? 1 : 0, incompleteCount: state === 'safety-evidence-required' ? 1 : 0, comparisonCount: Math.max(0, sampleCount - 1), confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildTempPreviewSafetyPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildTempPreviewSafetyPlan(report({ sampleCount: 0, fileCount: 0, safeCount: 0, reviewCount: 0, comparisonCount: 0, candidateBytes: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildTempPreviewSafetyEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createTempPreviewSafetyLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(TEMP_PREVIEW_SAFETY_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeTempPreviewSafetyReports(null)).toThrow('reports must be an array');
    expect(() => mergeTempPreviewSafetyReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeTempPreviewSafetyReports([null])).toThrow('report must be an object');
    expect(() => mergeTempPreviewSafetyReports([report({ turbo: 'other' })])).toThrow('requires a preview-safety turbo report');
    expect(() => mergeTempPreviewSafetyReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeTempPreviewSafetyReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeTempPreviewSafetyReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeTempPreviewSafetyReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeTempPreviewSafetyReports([report({ fileCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeTempPreviewSafetyReports([report({ candidateBytes: -1 })])).toThrow('candidateBytes must be non-negative');
    expect(() => mergeTempPreviewSafetyReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeTempPreviewSafetyReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildTempPreviewSafetyEnvelope(report())).toThrow('trigger is required');
    expect(() => buildTempPreviewSafetyEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
