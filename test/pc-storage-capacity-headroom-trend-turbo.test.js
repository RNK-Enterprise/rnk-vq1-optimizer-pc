import {
  STORAGE_CAPACITY_HEADROOM_TREND_TURBO_ID,
  runStorageCapacityHeadroomTrendTurbo
} from '../pc/engines/storage-capacity/turbos/headroom-trend/turbo.js';

const facts = (freeBytes, environment = 'interactive') => ({ engine: 'system-facts', environment, storage: [{ totalBytes: 1000, freeBytes }] });

describe('storage-capacity headroom-trend turbo', () => {
  test('detects sustained adjacent headroom decline', () => {
    const result = runStorageCapacityHeadroomTrendTurbo([
      facts(800), facts(700), facts(600)
    ], { trigger: 'workload.changed', minimumSamples: 3, declineThreshold: 5, persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(STORAGE_CAPACITY_HEADROOM_TREND_TURBO_ID);
    expect(result.state).toBe('headroom-decline-sustained');
    expect(result.declineSampleCount).toBe(2);
    expect(result.minimumFreePercent).toBe(60);
    expect(result.recommendations).toEqual(['review-capacity-trend', 'hold-automatic-cleanup']);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, stable, empty, and incomplete trends', () => {
    const observed = runStorageCapacityHeadroomTrendTurbo([facts(800), facts(700), facts(720)], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const stable = runStorageCapacityHeadroomTrendTurbo([facts(700), facts(720), facts(710)], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runStorageCapacityHeadroomTrendTurbo([{ engine: 'system-facts', environment: 'interactive', storage: [] }, { engine: 'system-facts', environment: 'interactive', storage: [] }], { trigger: 'install.preflight', now: () => 0 });
    const incomplete = runStorageCapacityHeadroomTrendTurbo([facts(null, 'unknown'), facts(null)], { trigger: 'health.interval', now: () => 0 });
    const incompleteRows = runStorageCapacityHeadroomTrendTurbo([
      { engine: 'system-facts', environment: 'interactive', storage: [{ totalBytes: null, freeBytes: null }, { totalBytes: 0, freeBytes: 0 }, { totalBytes: 1000 }] }
    ], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    expect(observed.state).toBe('headroom-decline-observed');
    expect(stable.state).toBe('stable-headroom-trend');
    expect(empty.state).toBe('no-storage');
    expect(incomplete.state).toBe('incomplete-trend-evidence');
    expect(incompleteRows.state).toBe('incomplete-trend-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runStorageCapacityHeadroomTrendTurbo([facts(800), facts(400)], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runStorageCapacityHeadroomTrendTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1);
    expect(bounded.declineSampleCount).toBe(0);
    expect(bounded.state).toBe('stable-headroom-trend');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runStorageCapacityHeadroomTrendTurbo()).toThrow();
    expect(() => runStorageCapacityHeadroomTrendTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runStorageCapacityHeadroomTrendTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityHeadroomTrendTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityHeadroomTrendTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityHeadroomTrendTurbo([{ engine: 'system-facts', storage: null }], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityHeadroomTrendTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runStorageCapacityHeadroomTrendTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow();
    expect(() => runStorageCapacityHeadroomTrendTurbo([], { trigger: 'health.interval', declineThreshold: 101 })).toThrow();
    expect(() => runStorageCapacityHeadroomTrendTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow();
    expect(() => runStorageCapacityHeadroomTrendTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
