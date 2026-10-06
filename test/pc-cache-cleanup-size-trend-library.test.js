import {
  CACHE_SIZE_TREND_LIBRARY_ID,
  CACHE_SIZE_TREND_LIBRARY_VERSION,
  buildCacheSizeTrendEnvelope,
  buildCacheSizeTrendPlan,
  createCacheSizeTrendLibrary,
  mergeCacheSizeTrendReports
} from '../pc/engines/cache-cleanup/turbos/size-trend/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  const comparisonCount = overrides.comparisonCount ?? Math.max(0, sampleCount - 1);
  return {
    turbo: 'cache-cleanup.size-trend', state: 'stable-size', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, minimumDeltaBytes: 1,
    cacheCount: 2, knownCount: 2, invalidSizeCount: 0, totalBytes: 20,
    comparisonCount, changeCount: 0, increaseCount: 0, decreaseCount: 0,
    deltaBytes: 0, finalEnvironment: 'interactive', confidence: 1, ...overrides
  };
}

describe('cache-cleanup size-trend library', () => {
  test('publishes identity and merges size evidence', () => {
    const merged = mergeCacheSizeTrendReports([
      report({ sampleCount: 2, comparisonCount: 1 }),
      report({ state: 'size-drift-sustained', sampleCount: 4, cacheCount: 1,
        knownCount: 1, totalBytes: 30, comparisonCount: 3, changeCount: 2,
        increaseCount: 2, decreaseCount: 0, deltaBytes: 10, finalEnvironment: 'headless' })
    ]);
    expect(CACHE_SIZE_TREND_LIBRARY_ID).toBe('cache-cleanup.size-trend.library');
    expect(CACHE_SIZE_TREND_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'size-drift-sustained',
      sampleCount: 6, cacheCount: 1, knownCount: 1, invalidSizeCount: 0, totalBytes: 30,
      comparisonCount: 4, changeCount: 2, increaseCount: 2, decreaseCount: 0,
      deltaBytes: 10, finalEnvironment: 'headless', confidence: 1,
      recommendations: ['review-cache-size-trend-without-file-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('merges every state and builds every state plan', () => {
    expect(mergeCacheSizeTrendReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-cache-size-samples'] });
    expect(mergeCacheSizeTrendReports([report({ sampleCount: 0, cacheCount: 0, knownCount: 0,
      totalBytes: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
    expect(mergeCacheSizeTrendReports([report({ state: 'invalid-size-evidence', cacheCount: 1,
      knownCount: 1, invalidSizeCount: 1 })]).recommendations).toEqual(['review-cache-size-evidence']);
    expect(mergeCacheSizeTrendReports([report({ state: 'size-drift-observed', comparisonCount: 1,
      changeCount: 1, decreaseCount: 1, deltaBytes: -10 })]).recommendations)
      .toEqual(['observe-cache-size-stability']);
    expect(mergeCacheSizeTrendReports([report({ state: 'no-size-observation', cacheCount: 0,
      knownCount: 0, totalBytes: 0, confidence: 0 })]).recommendations)
      .toEqual(['request-cache-size-observation']);
    expect(mergeCacheSizeTrendReports([report()]).recommendations).toEqual(['preview-safe-cache-candidates']);
    expect(mergeCacheSizeTrendReports([report({ state: 'insufficient-data', sampleCount: 1,
      cacheCount: 0, knownCount: 0, totalBytes: 0, comparisonCount: 0, confidence: 0 })]).state)
      .toBe('insufficient-data');
    const states = [
      ['invalid-size-evidence', 'size-evidence-review', 750],
      ['size-drift-sustained', 'size-trend-review', 1000],
      ['size-drift-observed', 'size-trend-observation', 1500],
      ['no-size-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 2000],
      ['stable-size', 'stable-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-size-observation' || state === 'insufficient-data';
      const sampleCount = state === 'insufficient-data' ? 0 : (empty ? 1 : 4);
      const knownCount = empty ? 0 : 2;
      expect(buildCacheSizeTrendPlan(report({ state, sampleCount, cacheCount: empty ? 0 : 2,
        knownCount, invalidSizeCount: state === 'invalid-size-evidence' ? 1 : 0,
        totalBytes: knownCount * 10, comparisonCount: Math.max(0, sampleCount - 1),
        confidence: knownCount > 0 ? 1 : 0 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildCacheSizeTrendPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildCacheSizeTrendPlan(report({ sampleCount: 0, cacheCount: 0, knownCount: 0,
      totalBytes: 0, comparisonCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildCacheSizeTrendEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: CACHE_SIZE_TREND_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createCacheSizeTrendLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(CACHE_SIZE_TREND_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, cacheCount: 0, knownCount: 0,
      totalBytes: 0, comparisonCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, bytes, environments, triggers, and clocks', () => {
    expect(() => mergeCacheSizeTrendReports(null)).toThrow('reports must be an array');
    expect(() => mergeCacheSizeTrendReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCacheSizeTrendReports([null])).toThrow('report must be an object');
    expect(() => mergeCacheSizeTrendReports([report({ turbo: 'other' })]))
      .toThrow('requires a size-trend turbo report');
    expect(() => mergeCacheSizeTrendReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeCacheSizeTrendReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeCacheSizeTrendReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeCacheSizeTrendReports([report({ persistenceThreshold: 65 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeCacheSizeTrendReports([report({ minimumDeltaBytes: -1 })]))
      .toThrow('minimumDeltaBytes must be a safe non-negative number');
    for (const field of ['cacheCount', 'knownCount', 'invalidSizeCount']) {
      expect(() => mergeCacheSizeTrendReports([report({ [field]: 4097 })])).toThrow('must be from 0 to 4096');
    }
    for (const field of ['totalBytes', 'deltaBytes']) {
      expect(() => mergeCacheSizeTrendReports([report({ [field]: Number.MAX_SAFE_INTEGER + 1 })]))
        .toThrow('must be a safe number');
    }
    expect(() => mergeCacheSizeTrendReports([report({ comparisonCount: 4 })]))
      .toThrow('comparisonCount must fit inside the sample window');
    for (const field of ['changeCount', 'increaseCount', 'decreaseCount']) {
      expect(() => mergeCacheSizeTrendReports([report({ comparisonCount: 1, [field]: 2 })]))
        .toThrow('must fit inside comparisonCount');
    }
    expect(() => mergeCacheSizeTrendReports([report({ finalEnvironment: 'other' })]))
      .toThrow('finalEnvironment must be normalized');
    expect(() => mergeCacheSizeTrendReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildCacheSizeTrendEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCacheSizeTrendEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
