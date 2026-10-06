import { DISK_IO_EVIDENCE_TURBO_ID, runDiskIoEvidenceTurbo } from '../pc/engines/disk-io/turbos/io-evidence/turbo.js';

const complete = () => ({ readBytesPerSecond: 100, writeBytesPerSecond: 50, ioWaitPercent: 5 });
const facts = (storage, environment = 'interactive') => ({ engine: 'system-facts', environment, storage });

describe('disk-io io-evidence turbo', () => {
  test('detects sustained I/O evidence gaps without probing', () => {
    const result = runDiskIoEvidenceTurbo([facts([complete(), { readBytesPerSecond: 100, ioWaitPercent: 5 }]), facts([complete(), { readBytesPerSecond: 100, writeBytesPerSecond: 50 }])], { trigger: 'workload.changed', minimumSamples: 2, evidenceThreshold: 0.75, persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(DISK_IO_EVIDENCE_TURBO_ID); expect(result.state).toBe('io-evidence-gap-sustained'); expect(result.gapSampleCount).toBe(2); expect(result.evidenceRatio).toBe(0.5); expect(result.recommendations).toEqual(['request-complete-io-facts']); expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes observed, complete, empty, and incomplete samples', () => {
    const observed = runDiskIoEvidenceTurbo([facts([complete(), { readBytesPerSecond: 100 }]), facts([complete(), complete()])], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const completeResult = runDiskIoEvidenceTurbo([facts([complete()]), facts([complete()])], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runDiskIoEvidenceTurbo([facts([]), facts([])], { trigger: 'install.preflight', now: () => 0 });
    const incomplete = runDiskIoEvidenceTurbo([facts([complete()], 'unknown'), facts([complete()], 'unknown')], { trigger: 'health.interval', now: () => 0 });
    expect(observed.state).toBe('io-evidence-gap-observed'); expect(completeResult.state).toBe('complete-io-evidence'); expect(empty.state).toBe('no-disks'); expect(incomplete.state).toBe('incomplete-io-evidence');
  });
  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runDiskIoEvidenceTurbo([facts([complete()]), facts([{ readBytesPerSecond: 100 }])], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 }); const insufficient = runDiskIoEvidenceTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1); expect(bounded.evidenceRatio).toBe(0); expect(bounded.state).toBe('io-evidence-gap-observed'); expect(insufficient.state).toBe('insufficient-data'); expect(insufficient.confidence).toBe(0);
  });
  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runDiskIoEvidenceTurbo()).toThrow(); expect(() => runDiskIoEvidenceTurbo([], { trigger: 'bad' })).toThrow(); expect(() => runDiskIoEvidenceTurbo('bad', { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoEvidenceTurbo([{}], { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoEvidenceTurbo([null], { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoEvidenceTurbo([facts({})], { trigger: 'health.interval' })).toThrow(); expect(() => runDiskIoEvidenceTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow(); expect(() => runDiskIoEvidenceTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow(); expect(() => runDiskIoEvidenceTurbo([], { trigger: 'health.interval', evidenceThreshold: 1.1 })).toThrow(); expect(() => runDiskIoEvidenceTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow(); expect(() => runDiskIoEvidenceTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
