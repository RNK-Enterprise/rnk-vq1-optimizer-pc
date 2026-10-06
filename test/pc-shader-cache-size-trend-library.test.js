import { SHADER_SIZE_TREND_LIBRARY_ID, SHADER_SIZE_TREND_LIBRARY_VERSION,
  buildShaderSizeTrendEnvelope, buildShaderSizeTrendPlan, createShaderSizeTrendLibrary,
  mergeShaderSizeTrendReports } from '../pc/engines/shader-cache/turbos/size-trend/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'shader-cache.size-trend', state: 'stable-size', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    cacheCount: 1, sizedCount: 1, unknownSizeCount: 0, comparisonCount: Math.max(0, sampleCount - 1), growthCount: 0, shrinkCount: 0,
    finalTotalBytes: 10, finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('shader-cache size-trend library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeShaderSizeTrendReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'size-growth-sustained', growthCount: 2, finalTotalBytes: 30, finalEnvironment: 'headless' })]);
    expect(SHADER_SIZE_TREND_LIBRARY_ID).toBe('shader-cache.size-trend.library'); expect(SHADER_SIZE_TREND_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'size-growth-sustained', sampleCount: 6, cacheCount: 1, sizedCount: 1, comparisonCount: 4, growthCount: 2, finalTotalBytes: 30, finalEnvironment: 'headless', recommendations: ['review-cache-growth-without-file-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeShaderSizeTrendReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-cache-size-samples'] });
    expect(mergeShaderSizeTrendReports([report({ state: 'no-caches', cacheCount: 0, sizedCount: 0, comparisonCount: 0, finalTotalBytes: 0, confidence: 0.5 })]).recommendations).toEqual(['no-shader-cache-review']);
    expect(mergeShaderSizeTrendReports([report({ state: 'size-observation-required', unknownSizeCount: 1, sizedCount: 0 })]).recommendations).toEqual(['request-shader-cache-size-observation']);
    expect(mergeShaderSizeTrendReports([report({ state: 'size-growth-observed', growthCount: 1 })]).recommendations).toEqual(['observe-cache-size-stability']);
    expect(mergeShaderSizeTrendReports([report({ state: 'size-shrink-observed', shrinkCount: 1 })]).recommendations).toEqual(['record-cache-size-shrinkage']);
    expect(mergeShaderSizeTrendReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeShaderSizeTrendReports([report({ state: 'insufficient-data', sampleCount: 1, cacheCount: 0, sizedCount: 0, comparisonCount: 0, finalTotalBytes: 0, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs, sampleCount, cacheCount, finalTotalBytes, confidence] of [['no-caches', 'empty-observation', 10000, 4, 0, 0, 0.5], ['size-growth-sustained', 'size-review', 1000, 4, 1, 30, 1], ['size-growth-observed', 'size-observation', 1500, 4, 1, 20, 1], ['size-shrink-observed', 'shrink-review', 1500, 4, 1, 5, 1], ['size-observation-required', 'evidence-bootstrap', 2000, 4, 1, 10, 0.5], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0, 0, 0], ['stable-size', 'stable-observation', 5000, 4, 1, 10, 1]]) {
      expect(buildShaderSizeTrendPlan(report({ state, sampleCount, cacheCount, sizedCount: state === 'size-observation-required' ? 0 : cacheCount, unknownSizeCount: state === 'size-observation-required' ? 1 : 0, comparisonCount: Math.max(0, sampleCount - 1), finalTotalBytes, confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildShaderSizeTrendPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildShaderSizeTrendPlan(report({ sampleCount: 0, cacheCount: 0, sizedCount: 0, unknownSizeCount: 0, comparisonCount: 0, finalTotalBytes: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildShaderSizeTrendEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createShaderSizeTrendLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(SHADER_SIZE_TREND_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeShaderSizeTrendReports(null)).toThrow('reports must be an array');
    expect(() => mergeShaderSizeTrendReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeShaderSizeTrendReports([null])).toThrow('report must be an object');
    expect(() => mergeShaderSizeTrendReports([report({ turbo: 'other' })])).toThrow('requires a size-trend turbo report');
    expect(() => mergeShaderSizeTrendReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeShaderSizeTrendReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeShaderSizeTrendReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeShaderSizeTrendReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeShaderSizeTrendReports([report({ cacheCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeShaderSizeTrendReports([report({ finalTotalBytes: -1 })])).toThrow('finalTotalBytes must be non-negative');
    expect(() => mergeShaderSizeTrendReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeShaderSizeTrendReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildShaderSizeTrendEnvelope(report())).toThrow('trigger is required');
    expect(() => buildShaderSizeTrendEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
