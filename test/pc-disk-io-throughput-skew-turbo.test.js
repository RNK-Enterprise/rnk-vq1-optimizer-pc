import { DISK_IO_THROUGHPUT_SKEW_TURBO_ID, runDiskIoThroughputSkewTurbo } from '../pc/engines/disk-io/turbos/throughput-skew/turbo.js';

const facts = (storage, environment = 'interactive') => ({ engine: 'system-facts', environment, storage });
const disk = (readBytesPerSecond, writeBytesPerSecond) => ({ readBytesPerSecond, writeBytesPerSecond });

describe('disk-io throughput-skew turbo', () => {
  test('detects sustained read/write imbalance', () => {
    const result = runDiskIoThroughputSkewTurbo([facts([disk(100, 0)]), facts([disk(200, 20)])], { trigger: 'workload.changed', minimumSamples: 2, skewThreshold: 60, persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(DISK_IO_THROUGHPUT_SKEW_TURBO_ID); expect(result.state).toBe('throughput-skew-sustained'); expect(result.skewSampleCount).toBe(2); expect(result.maximumSkewPercent).toBe(90); expect(result.recommendations).toEqual(['review-read-write-contention', 'hold-queue-policy-change']); expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes observed, balanced, empty, and incomplete samples', () => {
    const observed = runDiskIoThroughputSkewTurbo([facts([disk(100, 0)]), facts([disk(50, 50)])], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const balanced = runDiskIoThroughputSkewTurbo([facts([disk(50, 50)]), facts([disk(100, 90)])], { trigger: 'system.facts.request', now: () => 0 });
    const zero = runDiskIoThroughputSkewTurbo([facts([disk(0, 0)])], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    const empty = runDiskIoThroughputSkewTurbo([facts([]), facts([])], { trigger: 'install.preflight', now: () => 0 });
    const incomplete = runDiskIoThroughputSkewTurbo([facts([disk(50, null)], 'unknown'), facts([disk(null, 1)])], { trigger: 'health.interval', now: () => 0 });
    expect(observed.state).toBe('throughput-skew-observed'); expect(balanced.state).toBe('balanced-throughput'); expect(zero.state).toBe('balanced-throughput'); expect(empty.state).toBe('no-disks'); expect(incomplete.state).toBe('incomplete-throughput-evidence');
  });
  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runDiskIoThroughputSkewTurbo([facts([disk(100, 0)]), facts([disk(50, 50)])], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 }); const insufficient = runDiskIoThroughputSkewTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1); expect(bounded.maximumSkewPercent).toBe(0); expect(bounded.state).toBe('balanced-throughput'); expect(insufficient.state).toBe('insufficient-data'); expect(insufficient.confidence).toBe(0);
  });
  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runDiskIoThroughputSkewTurbo()).toThrow(); expect(() => runDiskIoThroughputSkewTurbo([], { trigger: 'bad' })).toThrow(); expect(() => runDiskIoThroughputSkewTurbo('bad', { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoThroughputSkewTurbo([{}], { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoThroughputSkewTurbo([null], { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoThroughputSkewTurbo([facts({})], { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoThroughputSkewTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow(); expect(() => runDiskIoThroughputSkewTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow(); expect(() => runDiskIoThroughputSkewTurbo([], { trigger: 'health.interval', skewThreshold: 101 })).toThrow(); expect(() => runDiskIoThroughputSkewTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow(); expect(() => runDiskIoThroughputSkewTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
