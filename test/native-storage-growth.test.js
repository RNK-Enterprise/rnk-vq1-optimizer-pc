import {
  STORAGE_GROWTH_CATEGORIES,
  buildStorageGrowthReport,
  createStorageGrowthTracker
} from '../native/storage-growth.js';

const NOW = Date.parse('2026-10-08T12:00:00.000Z');
const hour = 60 * 60 * 1000;

function sample(timestamp, freeBytes, temporaryBytes = null, reclaimableBytes = null) {
  return {
    timestamp,
    freeBytes,
    reclaimableBytes,
    categories: { 'temporary-files': temporaryBytes }
  };
}

describe('native storage growth evidence', () => {
  test('reports missing, stable, growing, and falling evidence', () => {
    expect(STORAGE_GROWTH_CATEGORIES).toHaveLength(6);
    expect(buildStorageGrowthReport()).toMatchObject({ state: 'no-data' });
    expect(buildStorageGrowthReport([], { now: () => NOW })).toMatchObject({ state: 'no-data', sampleCount: 0, recommendations: ['collect-storage-growth-evidence'] });
    const stable = buildStorageGrowthReport([
      sample(NOW - hour, 100, 10, 10),
      sample(NOW, 100, 10, 10)
    ], { now: () => NOW, growthThresholdBytes: 1 });
    expect(stable).toMatchObject({ state: 'stable', sampleCount: 2, freeBytes: { direction: 'stable' }, reclaimableBytes: { latest: 10 } });
    expect(stable.categories['package-cache']).toMatchObject({ direction: 'unknown', samples: 0 });
    const growth = buildStorageGrowthReport([
      { ...sample(NOW - hour, 200, 2, 2), categories: { 'temporary-files': 2, 'package-cache': 3 } },
      { ...sample(NOW, 100, 20, 20), categories: { 'temporary-files': 20, 'package-cache': 30 } }
    ], { now: () => NOW, growthThresholdBytes: 1 });
    expect(growth).toMatchObject({ state: 'growth-observed', freeBytes: { direction: 'falling' }, recommendations: expect.arrayContaining(['review-system-drive-growth', 'review-growing-reclaimable-category']) });
    expect(growth.growingCategories[0]).toMatchObject({ category: 'package-cache', delta: 27, direction: 'rising' });
    expect(growth.growingCategories).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'temporary-files', delta: 18 })]));
    const falling = buildStorageGrowthReport([
      sample(NOW - hour, 100, 20, 20),
      sample(NOW, 200, 2, 2)
    ], { now: () => NOW, growthThresholdBytes: 1 });
    expect(falling).toMatchObject({ state: 'stable', freeBytes: { direction: 'rising' }, reclaimableBytes: { direction: 'falling' } });
    expect(falling.recommendations).toEqual(['review-bounded-cleanup-preview']);
  });

  test('filters windows, bounds input, and validates options', () => {
    const report = buildStorageGrowthReport([
      sample(NOW - 2 * 24 * hour, 10, 1),
      sample(NOW - hour, 20, 2),
      sample(NOW + hour, 30, 3)
    ], { now: () => NOW, windowMs: 24 * hour, maxEntries: 1, growthThresholdBytes: 0 });
    expect(report.sampleCount).toBe(1);
    expect(report.freeBytes.latest).toBe(20);
    expect(() => buildStorageGrowthReport(null)).toThrow('entries must be an array');
    expect(buildStorageGrowthReport([null], { now: () => NOW })).toMatchObject({ state: 'no-data' });
    expect(() => buildStorageGrowthReport(new Array(4097).fill({ timestamp: NOW }))).toThrow('exceed the bound');
    expect(() => buildStorageGrowthReport([], { now: 1 })).toThrow('clock');
    expect(() => buildStorageGrowthReport([], { now: () => NaN })).toThrow('return a number');
    expect(() => buildStorageGrowthReport([], { windowMs: 1 })).toThrow('window');
    expect(() => buildStorageGrowthReport([], { maxEntries: 0 })).toThrow('maxEntries');
    expect(() => buildStorageGrowthReport([], { maxEntries: 4097 })).toThrow('maxEntries');
    expect(() => buildStorageGrowthReport([], { growthThresholdBytes: -1 })).toThrow('threshold');
    expect(() => buildStorageGrowthReport([], { growthThresholdBytes: NaN })).toThrow('threshold');
  });

  test('tracks samples, fills missing timestamps, and resets', () => {
    let clock = NOW - hour;
    const tracker = createStorageGrowthTracker({ now: () => clock, maxEntries: 2, growthThresholdBytes: 1 });
    expect(tracker.size()).toBe(0);
    expect(tracker.observe(sample(undefined, 100, 1))).toMatchObject({ sampleCount: 1, freeBytes: { latest: 100 } });
    clock = NOW;
    expect(tracker.observe(sample(NOW, 80, 3)).state).toBe('growth-observed');
    expect(tracker.size()).toBe(2);
    expect(tracker.observe(null).sampleCount).toBe(2);
    expect(tracker.size()).toBe(2);
    expect(tracker.reset()).toMatchObject({ state: 'no-data', sampleCount: 0 });
    expect(() => createStorageGrowthTracker({ now: 1 })).toThrow('clock');
    expect(() => createStorageGrowthTracker({ windowMs: 1 })).toThrow('window');
    expect(() => createStorageGrowthTracker({ maxEntries: 0 })).toThrow('maxEntries');
    expect(() => createStorageGrowthTracker({ growthThresholdBytes: -1 })).toThrow('threshold');
    const invalidClock = createStorageGrowthTracker({ now: () => NaN });
    expect(() => invalidClock.observe(sample(undefined, 1))).toThrow('timestamp');
    expect(createStorageGrowthTracker().read()).toMatchObject({ state: 'no-data' });
  });
});
