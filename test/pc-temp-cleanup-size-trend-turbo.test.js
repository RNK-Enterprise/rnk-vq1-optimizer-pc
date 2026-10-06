import { TEMP_SIZE_TREND_TRIGGERS, TEMP_SIZE_TREND_TURBO_ID,
  TEMP_SIZE_TREND_TURBO_VERSION, runTempSizeTrendTurbo } from '../pc/engines/temp-cleanup/turbos/size-trend/turbo.js';

function facts(sizeBytes, overrides = {}) { return { engine: 'system-facts', environment: 'interactive', temporaryFiles: [{ name: 'temp', sizeBytes, temporary: true, systemOwned: true }], ...overrides }; }
describe('temp-cleanup size-trend turbo', () => {
  test('publishes identity and detects sustained size growth', () => {
    expect(TEMP_SIZE_TREND_TURBO_ID).toBe('temp-cleanup.size-trend'); expect(TEMP_SIZE_TREND_TURBO_VERSION).toBe(1); expect(Object.isFrozen(TEMP_SIZE_TREND_TRIGGERS)).toBe(true);
    const result = runTempSizeTrendTurbo([facts(10), facts(20), facts(30)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: TEMP_SIZE_TREND_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3, fileCount: 1, candidateCount: 1,
      reviewCount: 0, sizedCount: 1, unknownSizeCount: 0, comparisonCount: 2, growthCount: 2, shrinkCount: 0, finalCandidateBytes: 30,
      finalEnvironment: 'interactive', state: 'size-growth-sustained', confidence: 1, recommendations: ['review-temp-growth-without-file-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes size states and empty evidence', () => {
    expect(runTempSizeTrendTurbo([facts(10), facts(10)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-size' });
    expect(runTempSizeTrendTurbo([facts(10), facts(20)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'size-growth-observed', growthCount: 1 });
    expect(runTempSizeTrendTurbo([facts(20), facts(10)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'size-shrink-observed', shrinkCount: 1 });
    expect(runTempSizeTrendTurbo([facts(undefined)], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'size-observation-required', unknownSizeCount: 1, confidence: 0.5 });
    expect(runTempSizeTrendTurbo([facts(10, { temporaryFiles: [{ name: 'temp', sizeBytes: 1, temporary: false, systemOwned: true }] })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'review-required', reviewCount: 1 });
    expect(runTempSizeTrendTurbo([facts(10, { temporaryFiles: [{ name: 'owned', sizeBytes: 1, temporary: true, systemOwned: true, userOwned: true }] })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'review-required', reviewCount: 1 });
    expect(runTempSizeTrendTurbo([facts(10, { temporaryFiles: [] }), facts(10, { temporaryFiles: [] })], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-temp-review', confidence: 0.25 });
    expect(runTempSizeTrendTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes rows and environments', () => {
    expect(runTempSizeTrendTurbo([facts(12, { environment: 'other', temporaryFiles: [null, { name: 'temp', sizeBytes: 12, temporary: true, systemOwned: true }] })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalEnvironment: 'unknown', fileCount: 1, candidateCount: 1, finalCandidateBytes: 12, state: 'stable-size', confidence: 1 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runTempSizeTrendTurbo([], { trigger: 'bad' })).toThrow('Unsupported temp-cleanup size-trend trigger: bad');
    expect(() => runTempSizeTrendTurbo()).toThrow('Unsupported temp-cleanup size-trend trigger: unknown');
    expect(() => runTempSizeTrendTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runTempSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runTempSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runTempSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runTempSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runTempSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runTempSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runTempSizeTrendTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runTempSizeTrendTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runTempSizeTrendTurbo([{ engine: 'system-facts', temporaryFiles: null }], { trigger: 'health.interval' })).toThrow('requires a temporary-file list');
    expect(() => runTempSizeTrendTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
