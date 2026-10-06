import { SHADER_SIZE_TREND_TRIGGERS, SHADER_SIZE_TREND_TURBO_ID,
  SHADER_SIZE_TREND_TURBO_VERSION, runShaderSizeTrendTurbo } from '../pc/engines/shader-cache/turbos/size-trend/turbo.js';

function facts(sizeBytes, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', shaderCaches: [{ sizeBytes }], ...overrides };
}
describe('shader-cache size-trend turbo', () => {
  test('publishes identity and detects sustained size growth', () => {
    expect(SHADER_SIZE_TREND_TURBO_ID).toBe('shader-cache.size-trend'); expect(SHADER_SIZE_TREND_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(SHADER_SIZE_TREND_TRIGGERS)).toBe(true);
    const result = runShaderSizeTrendTurbo([facts(10), facts(20), facts(30)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: SHADER_SIZE_TREND_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      cacheCount: 1, sizedCount: 1, unknownSizeCount: 0, comparisonCount: 2, growthCount: 2, shrinkCount: 0, finalTotalBytes: 30,
      finalEnvironment: 'interactive', state: 'size-growth-sustained', confidence: 1, recommendations: ['review-cache-growth-without-file-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes size states and empty evidence', () => {
    expect(runShaderSizeTrendTurbo([facts(10), facts(10)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-size' });
    expect(runShaderSizeTrendTurbo([facts(10), facts(20)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'size-growth-observed', growthCount: 1 });
    expect(runShaderSizeTrendTurbo([facts(20), facts(10)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'size-shrink-observed', shrinkCount: 1 });
    expect(runShaderSizeTrendTurbo([facts(undefined)], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'size-observation-required', unknownSizeCount: 1 });
    expect(runShaderSizeTrendTurbo([facts(10, { shaderCaches: [] }), facts(10, { shaderCaches: [] })], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-caches', cacheCount: 0, confidence: 0.5 });
    expect(runShaderSizeTrendTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes rows and environments', () => {
    expect(runShaderSizeTrendTurbo([facts(10, { environment: 'other', shaderCaches: [null, { sizeBytes: 12 }] })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalEnvironment: 'unknown', cacheCount: 1, sizedCount: 1, finalTotalBytes: 12, state: 'stable-size', confidence: 1 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runShaderSizeTrendTurbo([], { trigger: 'bad' })).toThrow('Unsupported shader-cache size-trend trigger: bad');
    expect(() => runShaderSizeTrendTurbo()).toThrow('Unsupported shader-cache size-trend trigger: unknown');
    expect(() => runShaderSizeTrendTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runShaderSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runShaderSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runShaderSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runShaderSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runShaderSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runShaderSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runShaderSizeTrendTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runShaderSizeTrendTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runShaderSizeTrendTurbo([{ engine: 'system-facts', shaderCaches: null }], { trigger: 'health.interval' })).toThrow('requires a shader-cache list');
    expect(() => runShaderSizeTrendTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
