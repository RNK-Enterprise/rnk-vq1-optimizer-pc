import { DISK_IO_WAIT_TREND_TURBO_ID, runDiskIoWaitTrendTurbo } from '../pc/engines/disk-io/turbos/wait-trend/turbo.js';

const facts = (waitPercent, environment = 'interactive') => ({ engine: 'system-facts', environment, storage: [{ ioWaitPercent: waitPercent }] });

describe('disk-io wait-trend turbo', () => {
  test('detects sustained adjacent wait increase', () => {
    const result = runDiskIoWaitTrendTurbo([facts(10), facts(20), facts(30)], { trigger: 'workload.changed', minimumSamples: 3, increaseThreshold: 5, persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(DISK_IO_WAIT_TREND_TURBO_ID); expect(result.state).toBe('wait-increase-sustained'); expect(result.increaseSampleCount).toBe(2); expect(result.maximumWaitPercent).toBe(30); expect(result.recommendations).toEqual(['review-contention-trend', 'protect-services']); expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes observed, stable, empty, and incomplete trends', () => {
    const observed = runDiskIoWaitTrendTurbo([facts(10), facts(20), facts(18)], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const stable = runDiskIoWaitTrendTurbo([facts(20), facts(22), facts(21)], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runDiskIoWaitTrendTurbo([{ engine: 'system-facts', environment: 'interactive', storage: [] }, { engine: 'system-facts', environment: 'interactive', storage: [] }], { trigger: 'install.preflight', now: () => 0 });
    const incomplete = runDiskIoWaitTrendTurbo([facts(null, 'unknown'), facts(null)], { trigger: 'health.interval', now: () => 0 });
    const incompleteRows = runDiskIoWaitTrendTurbo([{ engine: 'system-facts', environment: 'interactive', storage: [{ ioWaitPercent: null }, { ioWaitPercent: 0 }] }], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    expect(observed.state).toBe('wait-increase-observed'); expect(stable.state).toBe('stable-wait-trend'); expect(empty.state).toBe('no-disks'); expect(incomplete.state).toBe('incomplete-trend-evidence'); expect(incompleteRows.state).toBe('incomplete-trend-evidence');
  });
  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runDiskIoWaitTrendTurbo([facts(40), facts(10)], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 }); const insufficient = runDiskIoWaitTrendTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1); expect(bounded.increaseSampleCount).toBe(0); expect(bounded.state).toBe('stable-wait-trend'); expect(insufficient.state).toBe('insufficient-data'); expect(insufficient.confidence).toBe(0);
  });
  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runDiskIoWaitTrendTurbo()).toThrow(); expect(() => runDiskIoWaitTrendTurbo([], { trigger: 'bad' })).toThrow(); expect(() => runDiskIoWaitTrendTurbo('bad', { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoWaitTrendTurbo([{}], { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoWaitTrendTurbo([null], { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoWaitTrendTurbo([{ engine: 'system-facts', storage: null }], { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoWaitTrendTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow(); expect(() => runDiskIoWaitTrendTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow(); expect(() => runDiskIoWaitTrendTurbo([], { trigger: 'health.interval', increaseThreshold: 101 })).toThrow(); expect(() => runDiskIoWaitTrendTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow(); expect(() => runDiskIoWaitTrendTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
