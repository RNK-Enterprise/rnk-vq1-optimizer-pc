import { DISK_IO_WAIT_BURST_TURBO_ID, runDiskIoWaitBurstTurbo } from '../pc/engines/disk-io/turbos/wait-burst/turbo.js';

const facts = (storage, environment = 'interactive') => ({ engine: 'system-facts', environment, storage });

describe('disk-io wait-burst turbo', () => {
  test('detects sustained wait pressure without queue changes', () => {
    const result = runDiskIoWaitBurstTurbo([facts([{ ioWaitPercent: 35 }]), facts([{ ioWaitPercent: 40 }])], { trigger: 'workload.changed', minimumSamples: 2, waitThreshold: 30, persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(DISK_IO_WAIT_BURST_TURBO_ID); expect(result.state).toBe('wait-burst-sustained'); expect(result.pressureSampleCount).toBe(2); expect(result.maximumWaitPercent).toBe(40); expect(result.recommendations).toEqual(['protect-services', 'review-disk-contention']); expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes observed, stable, empty, and incomplete samples', () => {
    const observed = runDiskIoWaitBurstTurbo([facts([{ ioWaitPercent: 35 }]), facts([{ ioWaitPercent: 5 }])], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const stable = runDiskIoWaitBurstTurbo([facts([{ ioWaitPercent: 5 }]), facts([{ ioWaitPercent: 10 }])], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runDiskIoWaitBurstTurbo([facts([]), facts([])], { trigger: 'install.preflight', now: () => 0 });
    const incomplete = runDiskIoWaitBurstTurbo([facts([{ ioWaitPercent: 5 }], 'unknown'), facts([{}])], { trigger: 'health.interval', now: () => 0 });
    const edge = runDiskIoWaitBurstTurbo([facts([{ ioWaitPercent: null }, { ioWaitPercent: 0 }])], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    expect(observed.state).toBe('wait-burst-observed'); expect(stable.state).toBe('stable-wait'); expect(empty.state).toBe('no-disks'); expect(incomplete.state).toBe('incomplete-wait-evidence'); expect(edge.state).toBe('incomplete-wait-evidence');
  });
  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runDiskIoWaitBurstTurbo([facts([{ ioWaitPercent: 40 }]), facts([{ ioWaitPercent: 5 }])], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 }); const insufficient = runDiskIoWaitBurstTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1); expect(bounded.maximumWaitPercent).toBe(5); expect(bounded.state).toBe('stable-wait'); expect(insufficient.state).toBe('insufficient-data'); expect(insufficient.confidence).toBe(0);
  });
  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runDiskIoWaitBurstTurbo()).toThrow(); expect(() => runDiskIoWaitBurstTurbo([], { trigger: 'bad' })).toThrow(); expect(() => runDiskIoWaitBurstTurbo('bad', { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoWaitBurstTurbo([{}], { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoWaitBurstTurbo([null], { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoWaitBurstTurbo([facts({})], { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoWaitBurstTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow(); expect(() => runDiskIoWaitBurstTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow(); expect(() => runDiskIoWaitBurstTurbo([], { trigger: 'health.interval', waitThreshold: 101 })).toThrow(); expect(() => runDiskIoWaitBurstTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow(); expect(() => runDiskIoWaitBurstTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
