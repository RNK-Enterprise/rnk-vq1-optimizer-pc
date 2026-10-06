import { TEMP_SIZE_TREND_LIBRARY_ID, TEMP_SIZE_TREND_LIBRARY_VERSION,
  buildTempSizeTrendEnvelope, buildTempSizeTrendPlan, createTempSizeTrendLibrary,
  mergeTempSizeTrendReports } from '../pc/engines/temp-cleanup/turbos/size-trend/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'temp-cleanup.size-trend', state: 'stable-size', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    fileCount: 1, candidateCount: 1, reviewCount: 0, sizedCount: 1, unknownSizeCount: 0, comparisonCount: Math.max(0, sampleCount - 1), growthCount: 0, shrinkCount: 0,
    finalCandidateBytes: 10, finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('temp-cleanup size-trend library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeTempSizeTrendReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'size-growth-sustained', growthCount: 2, finalCandidateBytes: 30, finalEnvironment: 'headless' })]);
    expect(TEMP_SIZE_TREND_LIBRARY_ID).toBe('temp-cleanup.size-trend.library'); expect(TEMP_SIZE_TREND_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'size-growth-sustained', sampleCount: 6, fileCount: 1, candidateCount: 1, comparisonCount: 4, growthCount: 2, finalCandidateBytes: 30, finalEnvironment: 'headless', recommendations: ['review-temp-growth-without-file-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeTempSizeTrendReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-temp-size-samples'] });
    expect(mergeTempSizeTrendReports([report({ state: 'no-temp-review', fileCount: 0, candidateCount: 0, sizedCount: 0, comparisonCount: 0, finalCandidateBytes: 0, confidence: 0.25 })]).recommendations).toEqual(['no-temp-cleanup-review']);
    expect(mergeTempSizeTrendReports([report({ state: 'review-required', reviewCount: 1 })]).recommendations).toEqual(['review-temp-file-ownership']);
    expect(mergeTempSizeTrendReports([report({ state: 'size-observation-required', unknownSizeCount: 1, sizedCount: 0 })]).recommendations).toEqual(['request-temp-size-observation']);
    expect(mergeTempSizeTrendReports([report({ state: 'size-growth-observed', growthCount: 1 })]).recommendations).toEqual(['observe-temp-size-stability']);
    expect(mergeTempSizeTrendReports([report({ state: 'size-shrink-observed', shrinkCount: 1 })]).recommendations).toEqual(['record-temp-size-shrinkage']);
    expect(mergeTempSizeTrendReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeTempSizeTrendReports([report({ state: 'insufficient-data', sampleCount: 1, fileCount: 0, candidateCount: 0, sizedCount: 0, comparisonCount: 0, finalCandidateBytes: 0, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs, sampleCount, fileCount, confidence] of [['no-temp-review', 'empty-observation', 10000, 4, 0, 0.25], ['review-required', 'ownership-review', 750, 4, 1, 0.5], ['size-growth-sustained', 'size-review', 1000, 4, 1, 1], ['size-growth-observed', 'size-observation', 1500, 4, 1, 1], ['size-shrink-observed', 'shrink-review', 1500, 4, 1, 1], ['size-observation-required', 'evidence-bootstrap', 2000, 4, 1, 0.5], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0, 0], ['stable-size', 'stable-observation', 5000, 4, 1, 1]]) {
      expect(buildTempSizeTrendPlan(report({ state, sampleCount, fileCount, candidateCount: fileCount, reviewCount: state === 'review-required' ? 1 : 0, sizedCount: state === 'size-observation-required' ? 0 : fileCount, unknownSizeCount: state === 'size-observation-required' ? 1 : 0, comparisonCount: Math.max(0, sampleCount - 1), confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildTempSizeTrendPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildTempSizeTrendPlan(report({ sampleCount: 0, fileCount: 0, candidateCount: 0, sizedCount: 0, unknownSizeCount: 0, comparisonCount: 0, finalCandidateBytes: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildTempSizeTrendEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createTempSizeTrendLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(TEMP_SIZE_TREND_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeTempSizeTrendReports(null)).toThrow('reports must be an array');
    expect(() => mergeTempSizeTrendReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeTempSizeTrendReports([null])).toThrow('report must be an object');
    expect(() => mergeTempSizeTrendReports([report({ turbo: 'other' })])).toThrow('requires a size-trend turbo report');
    expect(() => mergeTempSizeTrendReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeTempSizeTrendReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeTempSizeTrendReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeTempSizeTrendReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeTempSizeTrendReports([report({ fileCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeTempSizeTrendReports([report({ finalCandidateBytes: -1 })])).toThrow('finalCandidateBytes must be non-negative');
    expect(() => mergeTempSizeTrendReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeTempSizeTrendReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildTempSizeTrendEnvelope(report())).toThrow('trigger is required');
    expect(() => buildTempSizeTrendEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
